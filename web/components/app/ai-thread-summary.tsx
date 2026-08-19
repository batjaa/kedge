'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { readAiRun, readLatestThreadSummary, startThreadSummary } from '@/lib/ai-client';
import { aiRunPhase, aiRunSettled, canRequestAiRun, isAiRunInFlight } from '@/lib/ai-run';
import type { AiRun, ThreadSummaryOutput } from '@/lib/ai-types';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

/**
 * The thread-summary affordance on a long thread (SPEC §14, user story 7): where
 * the discussion stands, and what it is still waiting on — so a reviewer can join
 * a forty-reply argument without reading forty replies.
 *
 * Read-only by construction. A summary marks nothing resolved, changes no status,
 * and is not stored on the thread; it is a run the reviewer reads (hard rule 5).
 *
 * On mount it re-attaches to the latest run for this thread, so a summary someone
 * already paid for is shown again rather than re-generated — the whole reason the
 * ledger's re-attach read exists (eng review §8).
 */
export function AiThreadSummary({ threadId }: { threadId: number }) {
  const t = useTranslations('ai-triage');
  const [run, setRun] = useState<AiRun<ThreadSummaryOutput> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    readLatestThreadSummary(threadId).then((latest) => {
      if (cancelled || latest === null) return;

      // Monotonic: a slow hydration must never displace a run the reader started
      // while it was in flight — that would strand the new run's poller.
      setRun((current) => (current === null || current.id < latest.id ? latest : current));
    });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const inFlight = run !== null && isAiRunInFlight(run.status);

  useEffect(() => {
    if (!inFlight) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [inFlight, run?.id]);

  const phase = aiRunPhase(run, now);
  const output = phase === 'completed' ? run?.output ?? null : null;

  async function request() {
    if (requestingRef.current) return;

    requestingRef.current = true;
    setRequesting(true);
    setError(null);

    const outcome = await startThreadSummary(threadId);

    requestingRef.current = false;
    setRequesting(false);

    if (outcome.ok) {
      setRun(outcome.run as AiRun<ThreadSummaryOutput>);

      return;
    }

    setError(outcome.message);
  }

  return (
    <div className="mt-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {t('summary.heading')}
        </span>
        {canRequestAiRun(phase) ? (
          <button
            type="button"
            onClick={() => void request()}
            disabled={requesting}
            className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5 dark:text-violet-200 dark:ring-violet-400/25 dark:hover:bg-white/10"
          >
            {phase === 'idle' ? t('summary.trigger') : t('summary.regenerate')}
          </button>
        ) : null}
      </div>

      {phase === 'idle' && !requesting ? (
        <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{t('summary.idle')}</p>
      ) : null}

      {phase === 'running' || requesting ? (
        <p role="status" className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {t('summary.generating')}
        </p>
      ) : null}

      {phase === 'taking-too-long' ? (
        <p role="status" className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {t('summary.takingTooLong')}
        </p>
      ) : null}

      {phase === 'failed' ? (
        <p role="alert" className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          {run?.error?.message ?? t('summary.failed')}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}

      {output ? <SummaryReport output={output} model={run?.model ?? null} /> : null}

      {inFlight && run ? <SummaryPoller runId={run.id} onSettled={setRun} /> : null}
    </div>
  );
}

/**
 * Presentational and state-free, so it renders identically in the panel and in a
 * test. The coverage statement is printed VERBATIM from the run — the web never
 * re-derives it, so "covers 12 of 40 comments" can't be prettified into a lie.
 */
export function SummaryReport({ output, model }: { output: ThreadSummaryOutput; model: string | null }) {
  const t = useTranslations('ai-triage');
  const empty = output.current_state.trim() === '';

  if (empty) {
    return (
      <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {output.coverage.statement || t('summary.empty')}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <section>
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t('summary.currentState')}
        </h4>
        <p className="mt-0.5 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{output.current_state}</p>
      </section>

      <section>
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t('summary.openQuestion')}
        </h4>
        <p className="mt-0.5 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{output.open_question}</p>
      </section>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{output.coverage.statement}</p>

      {/* Hard rule 5, said out loud: the AI summarized, nothing changed. */}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        {model ? t('summary.draftNoticeWithModel', { model }) : t('summary.draftNotice')}
      </p>
    </div>
  );
}

/** One in-flight run's poll loop. Renders nothing. */
function SummaryPoller({ runId, onSettled }: {
  runId: number;
  onSettled: (run: AiRun<ThreadSummaryOutput>) => void;
}) {
  usePollUntilSettled<AiRun<ThreadSummaryOutput>>({
    poll: async () => aiRunSettled(await readAiRun<ThreadSummaryOutput>(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
