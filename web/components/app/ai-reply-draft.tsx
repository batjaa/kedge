'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { readAiRun } from '@/lib/ai-client';
import { aiRunPhase, aiRunSettled, isAiRunInFlight } from '@/lib/ai-run';
import { REPLY_STANCES, type AiRun, type ReplyDraftOutput, type ReplyStance } from '@/lib/ai-types';
import { useAiReplyDraft } from '@/lib/use-ai-reply-draft';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

/**
 * "Draft reply →" with a stance picker, in the thread panel footer (DESIGN.md,
 * SPEC §14 user story 5).
 *
 * The shape of this control is the feature: the author picks the position FIRST,
 * so the model is writing their reply rather than forming its own view — and the
 * result lands in the composer as ordinary editable text. There is no post
 * button here. The only way this reaches the thread is the author's own submit,
 * one control below (hard rule 5).
 *
 * A composer that already holds typed text is never replaced silently: the draft
 * is shown, and the author says which one survives (G12).
 */
export function AiReplyDraftAction({ threadId, composerBody, disabled, onInsert }: {
  threadId: number;
  composerBody: string;
  disabled: boolean;
  onInsert: (body: string) => void;
}) {
  const t = useTranslations('ai-triage');
  const draft = useAiReplyDraft({ threadId, composerBody, onInsert });
  const [now, setNow] = useState(() => Date.now());
  const { run } = draft;
  const inFlight = run !== null && isAiRunInFlight(run.status);

  // Drives the client-side taking-too-long ceiling while a run is in flight.
  useEffect(() => {
    if (!inFlight) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [inFlight, run?.id]);

  const phase = aiRunPhase(run, now);
  const busy = disabled || draft.requesting || phase === 'running';
  const coverage = run?.output?.coverage ?? null;
  const emptyDraft = phase === 'completed' && run?.output?.body.trim() === '';

  return (
    <div className="mt-3 border-t border-zinc-900/5 pt-3 dark:border-white/5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {t('replyDraft.label')}
        </span>
        {REPLY_STANCES.map((stance) => (
          <StanceButton
            key={stance}
            stance={stance}
            disabled={busy}
            active={draft.stance === stance}
            onClick={() => void draft.request(stance)}
          />
        ))}
      </div>

      {phase === 'running' || draft.requesting ? (
        <p role="status" className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {t('replyDraft.generating')}
        </p>
      ) : null}

      {phase === 'taking-too-long' ? (
        <p role="status" className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
          {t('replyDraft.takingTooLong')}
        </p>
      ) : null}

      {phase === 'failed' ? (
        <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          {run?.error?.message ?? t('replyDraft.failed')}
        </p>
      ) : null}

      {draft.error ? (
        <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          {draft.error}
        </p>
      ) : null}

      {emptyDraft ? (
        <p role="status" className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {coverage?.statement ?? t('replyDraft.empty')}
        </p>
      ) : null}

      {draft.pendingReplace !== null ? (
        <ReplyDraftConfirm
          body={draft.pendingReplace}
          onKeep={draft.dismiss}
          onReplace={draft.confirmReplace}
        />
      ) : null}

      {phase === 'completed' && !emptyDraft && draft.pendingReplace === null ? (
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
          {run?.model
            ? t('replyDraft.draftNoticeWithModel', { model: run.model })
            : t('replyDraft.draftNotice')}
        </p>
      ) : null}

      {inFlight && run ? <ReplyDraftPoller runId={run.id} onSettled={draft.settle} /> : null}
    </div>
  );
}

/**
 * The G12 gate, presentational and state-free.
 *
 * It only ever renders while the composer still holds the person's own text —
 * which is to say, this component existing on screen IS the guarantee that
 * nothing was overwritten. It shows the draft so the choice is informed, and
 * neither button is the default: replacing takes a deliberate click.
 */
export function ReplyDraftConfirm({ body, onReplace, onKeep }: {
  body: string;
  onReplace: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations('ai-triage');

  return (
    <div className="mt-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/10 dark:ring-amber-400/20">
      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
        {t('replyDraft.confirmTitle')}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-200/80">
        {t('replyDraft.confirmBody')}
      </p>
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 px-2.5 py-2 text-xs text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200">
        {body}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onKeep}
          className="rounded-full px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-white/5"
        >
          {t('replyDraft.keep')}
        </button>
        <button
          type="button"
          onClick={onReplace}
          className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-violet-400/15 dark:text-violet-200 dark:ring-1 dark:ring-inset dark:ring-violet-400/25"
        >
          {t('replyDraft.replace')}
        </button>
      </div>
    </div>
  );
}

function StanceButton({ stance, active, disabled, onClick }: {
  stance: ReplyStance;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('ai-triage');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The agent register is violet per DESIGN.md — an AI affordance never wears
      // the emerald of a human review action.
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:text-violet-200 dark:ring-violet-400/30'
          : 'bg-white text-zinc-600 ring-zinc-900/10 hover:bg-zinc-50 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10'
      }`}
    >
      {t(`stance.${stance}` as 'stance.accept')}
    </button>
  );
}

/** One in-flight run's poll loop. Renders nothing. */
function ReplyDraftPoller({ runId, onSettled }: {
  runId: number;
  onSettled: (run: AiRun<ReplyDraftOutput>) => void;
}) {
  usePollUntilSettled<AiRun<ReplyDraftOutput>>({
    poll: async () => aiRunSettled(await readAiRun<ReplyDraftOutput>(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
