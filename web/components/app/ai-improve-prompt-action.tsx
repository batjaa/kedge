'use client';

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiImprovePromptReport } from './ai-improve-prompt-report';
import { AiRunPoller } from './ai-run-poller';
import { AI_BUTTON_CLASS, AI_SECONDARY_BUTTON_CLASS, AiArtifactDialog } from './ai-artifact-dialog';
import { readLatestImprovePrompt, startImprovePrompt } from '@/lib/ai-client';
import { canRequestAiArtifact } from '@/lib/ai-run';
import { isImprovePromptOutput, type ImprovePromptOutput } from '@/lib/ai-types';
import { useAiArtifactRun, type AiArtifactFailure } from '@/lib/use-ai-artifact-run';

// The improve-the-doc prompt affordance, beside the digest in the document
// header (SPEC §14, user story 4): request a run, poll it to a terminal status,
// then show the one artifact the author copies into their coding agent.
//
// Nothing here writes review data, and nothing here rewrites the artifact: the
// prompt is copied to the clipboard exactly as the server rendered it, because
// it carries accepted suggested edits verbatim (hard rule 5, and the ticket's
// verbatim guarantee).
//
// Absent entirely when the instance has no Anthropic key — the surface is gated
// one level up, so there is no button to click and nothing to explain.

/** Which sentence names each start failure. Falls back to the client's own. */
const ERROR_KEYS: Record<AiArtifactFailure['kind'], string> = {
  unavailable: 'errors.unavailable',
  forbidden: 'errors.forbidden',
  conflict: 'errors.conflict',
  'rate-limited': 'errors.rateLimited',
  error: 'errors.error',
};

export function AiImprovePromptAction({ documentId }: { documentId: number }) {
  const t = useTranslations('ai-improve-prompt');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const { run, phase, inFlight, pending, failure, request, settle } = useAiArtifactRun({
    documentId,
    start: startImprovePrompt,
    readLatest: readLatestImprovePrompt,
  });

  const output = isImprovePromptOutput(run?.output ?? null) ? (run?.output as ImprovePromptOutput) : null;
  const copyable = output !== null && output.prompt.trim() !== '';

  async function generate() {
    setCopyError(null);
    await request();
  }

  async function copy(prompt: string) {
    try {
      // Byte for byte: the artifact's accepted suggested edits are only verbatim
      // if nothing on this side touches them.
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(t('copyFailed'));
    }
  }

  const error = copyError ?? (failure === null ? null : t(ERROR_KEYS[failure.kind]));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={AI_SECONDARY_BUTTON_CLASS}>
        <Wand2 className="h-4 w-4" aria-hidden="true" />
        {t('trigger')}
      </button>

      <AiArtifactDialog
        open={open}
        onClose={() => setOpen(false)}
        label={t('dialogLabel')}
        heading={t('heading')}
        description={t('description')}
        closeLabel={t('close')}
        actions={
          <>
            {phase === 'completed' && copyable ? (
              <button
                type="button"
                onClick={() => copy((output as ImprovePromptOutput).prompt)}
                className={AI_SECONDARY_BUTTON_CLASS}
              >
                {copied ? t('copied') : t('copy')}
              </button>
            ) : null}

            {canRequestAiArtifact(phase) ? (
              <button type="button" onClick={generate} disabled={pending} className={AI_BUTTON_CLASS}>
                {pending ? t('generating') : phase === 'idle' ? t('generate') : t('retry')}
              </button>
            ) : null}
          </>
        }
      >
        {phase === 'idle' ? <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('idle')}</p> : null}

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
          <p
            role="alert"
            className="rounded-xl bg-rose-50 px-3.5 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/20"
          >
            {run?.error?.message ?? t('failed')}
          </p>
        ) : null}

        {phase === 'completed' && output ? (
          <AiImprovePromptReport output={output} model={run?.model ?? null} />
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}
      </AiArtifactDialog>

      {inFlight && run ? <AiRunPoller runId={run.id} onSettled={settle} /> : null}
    </>
  );
}
