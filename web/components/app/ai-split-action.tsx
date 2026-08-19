'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SplitSquareHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiSplitProposals } from './ai-split-proposals';
import { IconButton } from './document-thread-ui';
import { readAiSplitRun, readLatestCommentSplit, startCommentSplit } from '@/lib/ai-client';
import {
  approvableSplitIndexes,
  initialSplitApprovals,
  isApprovingAnySplit,
  markSplitApproved,
  markSplitApproving,
  markSplitFailed,
  resolveSplitAnchor,
  splitIdempotencyKey,
  type SplitApprovals,
} from '@/lib/ai-split';
import { aiRunSettled, canRequestDigest, digestPhase, isAiRunInFlight } from '@/lib/ai-run';
import type { AiSplitRun, SplitProposal } from '@/lib/ai-types';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';
import type { ThreadAnchorPayload } from '@/lib/thread-types';

/**
 * The per-comment split affordance (SPEC §14 user story 6, #134): an icon beside
 * the fork action that opens a proposal panel, requests a run, polls it to a
 * terminal status, and renders the proposals as a review list.
 *
 * **This component never writes review data.** Approving a proposal calls back
 * to the review surface, which POSTs the ordinary fork endpoint with the
 * proposal's anchor — the same call a manual fork makes, through the same Policy
 * and the same server-side anchor validation (hard rule 5). The run's output is
 * inert until then, and stays inert for every proposal nobody approves.
 *
 * Approve-all walks the proposals ONE AT A TIME and keeps going past a failure:
 * an anchor invalidated by an edit between generation and approval fails exactly
 * its own row, and the rest of the list stays approvable.
 *
 * Absent entirely when the instance has no Anthropic key — the surface is gated
 * one level up, so there is no button here to 404.
 */
export type ApproveSplitFn = (
  commentId: number,
  idempotencyKey: string,
  anchor: ThreadAnchorPayload | null,
) => Promise<string | null>;

export function AiSplitAction({
  commentId,
  onApproveSplit,
}: {
  commentId: number;
  onApproveSplit: ApproveSplitFn;
}) {
  const t = useTranslations('ai-split');
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<AiSplitRun | null>(null);
  const [approvals, setApprovals] = useState<SplitApprovals>(() => initialSplitApprovals(0));
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestingRef = useRef(false);
  const approvingRef = useRef(false);
  const attachedRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Re-attach when the panel is OPENED, not on mount: a run started before a
  // reload, or finished while the panel was closed, is picked back up rather
  // than forgotten and re-billed. Deferring it to the open is the whole
  // difference between one request and one per comment in the rail — this
  // affordance renders on every forkable reply on the page.
  //
  // The latch is set only on a CONCLUSIVE answer. A dropped read that latched
  // would leave the panel believing no run exists, and the next click would bill
  // the key for a second run whose answer already existed; leaving it unlatched
  // means closing and reopening simply tries again.
  useEffect(() => {
    if (!open || attachedRef.current) return;

    let cancelled = false;

    readLatestCommentSplit(commentId).then((outcome) => {
      if (cancelled || outcome.kind === 'unavailable') return;

      attachedRef.current = true;

      if (outcome.kind === 'none') return;

      // Monotonic: a slow read must never displace a run the user started while
      // it was in flight — that would strand the new run's poller.
      setRun((current) => (current === null || current.id < outcome.run.id ? outcome.run : current));
    });

    return () => {
      cancelled = true;
    };
  }, [open, commentId]);

  // A new set of proposals is a new set of approvals: keying the reset on the
  // run id means a retry can never show yesterday's approved ticks against
  // today's proposals.
  const proposals: SplitProposal[] = run?.output?.proposals ?? [];
  const proposalCount = proposals.length;
  const runId = run?.id ?? null;
  useEffect(() => {
    setApprovals(initialSplitApprovals(proposalCount));
  }, [runId, proposalCount]);

  const inFlight = run !== null && isAiRunInFlight(run.status);
  useEffect(() => {
    if (!inFlight) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [inFlight, run?.id]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const phase = digestPhase(run, now);
  const busy = isApprovingAnySplit(approvals);

  async function request() {
    if (requestingRef.current) return;
    requestingRef.current = true;
    setPending(true);
    setError(null);

    const outcome = await startCommentSplit(commentId);

    requestingRef.current = false;
    setPending(false);

    if (outcome.ok) {
      setRun(outcome.run);
      return;
    }

    setError(outcome.message);
  }

  /**
   * Approve one proposal, and never throw. Anything that goes wrong — a
   * rejected anchor, a dropped connection, a malformed payload — is recorded
   * against THIS proposal and nothing else, which is what lets approve-all walk
   * past a failure instead of dying on it.
   */
  async function approve(index: number, currentRunId: number, proposal: SplitProposal) {
    const resolution = resolveSplitAnchor(proposal);

    // A malformed anchor is never posted: dropping it would fork against the
    // source thread's selection and look like a success.
    if (resolution.kind === 'invalid') {
      setApprovals((current) => markSplitFailed(current, index, t('invalidAnchor')));

      return;
    }

    setApprovals((current) => markSplitApproving(current, index));

    let message: string | null;

    try {
      message = await onApproveSplit(
        commentId,
        splitIdempotencyKey(currentRunId, index),
        resolution.kind === 'anchor' ? resolution.anchor : null,
      );
    } catch {
      message = t('approveFailed');
    }

    setApprovals((current) => (message === null
      ? markSplitApproved(current, index)
      : markSplitFailed(current, index, message as string)));
  }

  async function approveOne(index: number) {
    if (approvingRef.current || runId === null) return;
    const proposal = proposals[index];
    if (!proposal) return;

    approvingRef.current = true;
    setError(null);

    try {
      await approve(index, runId, proposal);
    } finally {
      // The guard is released even on an unforeseen throw: leaving it latched
      // would disable every remaining approval until the page is remounted.
      approvingRef.current = false;
    }
  }

  /**
   * Approve every proposal still awaiting a decision, sequentially — and never
   * stop early. A rejected anchor is one row's problem; the remaining proposals
   * are still the author's to accept.
   */
  async function approveAll() {
    if (approvingRef.current || runId === null) return;
    approvingRef.current = true;
    setError(null);

    try {
      for (const index of approvableSplitIndexes(approvals)) {
        const proposal = proposals[index];
        if (!proposal) continue;
        await approve(index, runId, proposal);
      }
    } finally {
      approvingRef.current = false;
    }
  }

  return (
    <>
      <IconButton title={t('trigger')} onClick={() => setOpen(true)}>
        <SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </IconButton>

      {/* Portaled to <body>: the trigger sits inside the thread rail, which
          scrolls and clips — an overlay rendered in place would be trapped. */}
      {open ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('dialogLabel')}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6"
        >
          <button
            type="button"
            aria-label={t('close')}
            className="fixed inset-0 cursor-default bg-zinc-900/45"
            onClick={() => setOpen(false)}
          />

          <div className="relative z-10 mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{t('heading')}</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('description')}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('close')}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4">
              {phase === 'idle' ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('idle')}</p>
              ) : null}

              {phase === 'running' ? (
                <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">{t('generating')}</p>
              ) : null}

              {phase === 'taking-too-long' ? (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t('takingTooLong')}</p>
              ) : null}

              {phase === 'failed' ? (
                <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/20">
                  {run?.error?.message ?? t('failed')}
                </p>
              ) : null}

              {phase === 'completed' && run?.output ? (
                <AiSplitProposals
                  output={run.output}
                  approvals={approvals}
                  model={run.model}
                  busy={busy}
                  onApprove={(index) => void approveOne(index)}
                  onApproveAll={() => void approveAll()}
                />
              ) : null}

              {error ? (
                <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {canRequestDigest(phase) ? (
                <button
                  type="button"
                  onClick={request}
                  disabled={pending || busy}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/20 dark:hover:bg-violet-400/15"
                >
                  {pending ? t('generating') : phase === 'idle' ? t('generate') : t('retry')}
                </button>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {inFlight && run ? <SplitPoller runId={run.id} onSettled={setRun} /> : null}
    </>
  );
}

/** One in-flight run's poll loop. Renders nothing. */
function SplitPoller({ runId, onSettled }: { runId: number; onSettled: (run: AiSplitRun) => void }) {
  usePollUntilSettled<AiSplitRun>({
    poll: async () => aiRunSettled(await readAiSplitRun(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
