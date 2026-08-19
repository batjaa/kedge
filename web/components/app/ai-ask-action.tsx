'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AI_BUTTON_CLASS, AI_SECONDARY_BUTTON_CLASS, AiArtifactDialog } from './ai-artifact-dialog';
import { readAiRun, startAsk } from '@/lib/ai-client';
import type { StartRunFailure } from '@/lib/ai-client';
import { aiRunPhase, aiRunSettled, isAiRunInFlight } from '@/lib/ai-run';
import { MAX_ASK_QUESTION_CHARS, askQuestionIsAskable, askQuotePreview } from '@/lib/ai-ask';
import type { AiRun, AskOutput, AskQuote } from '@/lib/ai-types';
import { usePollUntilSettled } from '@/lib/use-poll-until-settled';

/**
 * Ask about the doc (SPEC §14, user story 23 — M4 #139).
 *
 * A reader poses a question in their own words — about the whole document from
 * the header, or about a passage they selected — and reads the answer. That is
 * the entire feature: there is no "turn this into a comment" action here,
 * because the api has no endpoint that could. Hard rule 5 holds by absence.
 *
 * **Ephemeral by construction, not by cleanup.** The dialog's state — the
 * question, the run, the answer — lives in {@link AskDialog}, which is
 * UNMOUNTED when the reader closes the panel. Nothing is re-fetched on mount
 * (there is no latest-ask read to fetch), and reopening gives an empty box.
 * Resetting state on close would be a promise the next refactor could quietly
 * break; not having the state is not.
 *
 * "Ephemeral" is a claim about this SURFACE, and the copy says exactly that:
 * nothing is posted to the review, and closing the panel is the end of the
 * answer. The run itself still lands in the `ai_runs` ledger, because cost is
 * cost (SPEC §14) — but no affordance anywhere leads back to it.
 *
 * The dialog is opened by the surface rather than by this component alone,
 * because the second entry point is the selection popover — one panel, two ways
 * in, and only one place the answer can be.
 */
export type AskRequest = { quote: AskQuote | null };

export function AiAskAction({
  documentId,
  request,
  onOpen,
  onClose,
}: {
  documentId: number;
  /** Non-null while the panel is open; carries the passage it was opened for. */
  request: AskRequest | null;
  onOpen: (quote: AskQuote | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations('ai-ask');

  return (
    <>
      <button type="button" onClick={() => onOpen(null)} className={AI_BUTTON_CLASS}>
        <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
        {t('trigger')}
      </button>

      {request ? (
        <AskDialog documentId={documentId} quote={request.quote} onClose={onClose} />
      ) : null}
    </>
  );
}

/**
 * One open panel, one question at a time.
 *
 * Single-turn (spec, "Ask about the doc"): asking again replaces the answer
 * rather than appending to a conversation, and the run that produced the old
 * answer is simply let go. Nothing here remembers the previous question, which
 * is what makes "a follow-up is a new ask" true on the client as well as the
 * server.
 */
function AskDialog({
  documentId,
  quote,
  onClose,
}: {
  documentId: number;
  quote: AskQuote | null;
  onClose: () => void;
}) {
  const t = useTranslations('ai-ask');
  const [question, setQuestion] = useState('');
  const [run, setRun] = useState<AiRun<AskOutput> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<StartRunFailure | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const askingRef = useRef(false);

  const inFlight = run !== null && isAiRunInFlight(run.status);

  useEffect(() => {
    if (!inFlight) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [inFlight, run?.id]);

  const phase = aiRunPhase(run, now);
  const output = phase === 'completed' ? run?.output ?? null : null;
  const askable = askQuestionIsAskable(question) && !asking && !inFlight;

  async function ask() {
    if (askingRef.current || !askQuestionIsAskable(question)) return;

    askingRef.current = true;
    setAsking(true);
    setFailure(null);
    setCopied(false);
    setCopyError(null);
    // The previous answer goes NOW, not when the new one lands: leaving it on
    // screen under a fresh spinner reads as "still the answer to this question".
    setRun(null);

    const outcome = await startAsk(documentId, question.trim(), quote);

    askingRef.current = false;
    setAsking(false);

    if (outcome.ok) {
      setRun(outcome.run as AiRun<AskOutput>);

      return;
    }

    setFailure(outcome);
  }

  async function copy() {
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output.answer);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(t('copyFailed'));
    }
  }

  const preview = quote ? askQuotePreview(quote.exact) : null;

  return (
    <AiArtifactDialog
      open
      onClose={onClose}
      label={t('dialogLabel')}
      heading={t('heading')}
      description={quote ? t('descriptionPassage') : t('description')}
      closeLabel={t('close')}
      actions={
        <>
          {output ? (
            <button type="button" onClick={() => void copy()} className={AI_SECONDARY_BUTTON_CLASS}>
              {copied ? t('copied') : t('copy')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void ask()}
            disabled={!askable}
            className={AI_BUTTON_CLASS}
          >
            {asking || phase === 'running' ? t('asking') : output || phase === 'failed' ? t('askAgain') : t('ask')}
          </button>
        </>
      }
    >
      {preview ? (
        <figure className="mb-3 rounded-xl bg-zinc-100 px-3.5 py-2 dark:bg-white/5">
          <figcaption className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('selectedPassage')}
          </figcaption>
          <blockquote className="mt-1 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{preview}</blockquote>
        </figure>
      ) : null}

      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="ai-ask-question">
        {t('questionLabel')}
      </label>
      <textarea
        id="ai-ask-question"
        rows={3}
        autoFocus
        maxLength={MAX_ASK_QUESTION_CHARS}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={t('placeholder')}
        className="mt-1.5 block w-full resize-none rounded-lg border-0 bg-zinc-50 p-3 text-sm leading-6 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700"
      />

      {phase === 'running' || asking ? (
        <p role="status" className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('asking')}</p>
      ) : null}

      {phase === 'taking-too-long' ? (
        <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t('takingTooLong')}</p>
      ) : null}

      {phase === 'failed' ? (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {run?.error?.message ?? t('failed')}
        </p>
      ) : null}

      {failure ? (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">{failure.message}</p>
      ) : null}

      {copyError ? (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">{copyError}</p>
      ) : null}

      {output ? <AskAnswer output={output} model={run?.model ?? null} /> : null}

      {inFlight && run ? <AskPoller runId={run.id} onSettled={setRun} /> : null}
    </AiArtifactDialog>
  );
}

/**
 * Presentational and state-free, so it renders identically in the panel and in
 * a test. The coverage statement is printed VERBATIM from the run — a long
 * document read only in part says so in its own words, and the web never
 * re-derives the sentence.
 */
export function AskAnswer({ output, model }: { output: AskOutput; model: string | null }) {
  const t = useTranslations('ai-ask');

  return (
    <div className="mt-4 space-y-2">
      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{output.answer}</p>

      <p className="rounded-xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
        {output.coverage.statement}
      </p>

      {/* Hard rule 5, said out loud — and the ephemerality promise with it. */}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        {model ? t('ephemeralNoticeWithModel', { model }) : t('ephemeralNotice')}
      </p>
    </div>
  );
}

/** One in-flight run's poll loop. Renders nothing. */
function AskPoller({ runId, onSettled }: { runId: number; onSettled: (run: AiRun<AskOutput>) => void }) {
  usePollUntilSettled<AiRun<AskOutput>>({
    poll: async () => aiRunSettled(await readAiRun<AskOutput>(runId)),
    onSettled,
    key: runId,
  });

  return null;
}
