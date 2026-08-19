'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiDigestReport } from './ai-digest-report';
import { readAiRun, readLatestDigest, startDigest } from '@/lib/ai-client';
import { digestToMarkdown } from '@/lib/ai-digest-markdown';
import { aiRunSettled, canRequestDigest, digestPhase, isAiRunInFlight } from '@/lib/ai-run';
import type { AiRun, DigestOutput } from '@/lib/ai-types';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

// The primary AI-digest affordance in the document header (DESIGN.md): a button
// that opens a panel, requests a run, polls it to a terminal status, and renders
// themes / contention points / consensus / action items with the run's own
// coverage line. Nothing here writes review data — a digest is a draft the
// author reads and copies (hard rule 5). Absent entirely when the instance has
// no Anthropic key: the surface is gated one level up.
//
// The agent register is violet per DESIGN.md; the button keeps the standard
// primary shape so the header reads as one row of controls.
const BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/20 dark:hover:bg-violet-400/15';

const SECONDARY_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10';

export function AiDigestAction({ documentId, documentTitle }: { documentId: number; documentTitle: string }) {
  const t = useTranslations('ai-digest');
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<AiRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestingRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Re-attach on mount (eng review §8): a run started before a reload, or
  // finished while the tab was closed, is picked back up rather than forgotten
  // and re-billed.
  useEffect(() => {
    let cancelled = false;

    readLatestDigest(documentId).then((latest) => {
      if (cancelled || latest === null) return;

      // Monotonic: a slow hydration must never displace a run the user started
      // while it was in flight — that would strand the new run's poller.
      setRun((current) => (current === null || current.id < latest.id ? latest : current));
    });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Drives the client-side taking-too-long ceiling while a run is in flight.
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

  async function request() {
    if (requestingRef.current) return;
    requestingRef.current = true;
    setPending(true);
    setError(null);

    const outcome = await startDigest(documentId);

    requestingRef.current = false;
    setPending(false);

    if (outcome.ok) {
      setRun(outcome.run);
      return;
    }

    setError(outcome.message);
  }

  async function copy(output: DigestOutput) {
    try {
      await navigator.clipboard.writeText(
        digestToMarkdown(output, {
          title: t('markdownTitle', { document: documentTitle }),
          themes: t('sections.themes'),
          contentionPoints: t('sections.contentionPoints'),
          consensus: t('sections.consensus'),
          actionItems: t('sections.actionItems'),
          empty: t('empty'),
        }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {t('trigger')}
      </button>

      {/* Portaled to <body>: the trigger sits inside the sticky header, whose
          backdrop-blur makes it the containing block for fixed descendants —
          rendered in place, this overlay would be confined to the header strip. */}
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
                <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('generating')}
                </p>
              ) : null}

              {phase === 'taking-too-long' ? (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
                  {t('takingTooLong')}
                </p>
              ) : null}

              {phase === 'failed' ? (
                <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/20">
                  {run?.error?.message ?? t('failed')}
                </p>
              ) : null}

              {phase === 'completed' && run?.output ? (
                <AiDigestReport output={run.output} model={run.model} />
              ) : null}

              {error ? (
                <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {phase === 'completed' && run?.output ? (
                <button type="button" onClick={() => copy(run.output as DigestOutput)} className={SECONDARY_CLASS}>
                  {copied ? t('copied') : t('copy')}
                </button>
              ) : null}

              {canRequestDigest(phase) ? (
                <button type="button" onClick={request} disabled={pending} className={BUTTON_CLASS}>
                  {pending ? t('generating') : phase === 'idle' ? t('generate') : t('retry')}
                </button>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {inFlight && run ? (
        <DigestPoller runId={run.id} onSettled={setRun} />
      ) : null}
    </>
  );
}

/**
 * One in-flight run's poll loop — the shared hook's next consumer. Polls the run
 * until it reaches a terminal status, then hands it up. Renders nothing.
 */
function DigestPoller({ runId, onSettled }: { runId: number; onSettled: (run: AiRun) => void }) {
  usePollUntilSettled<AiRun>({
    poll: async () => aiRunSettled(await readAiRun(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
