'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiDigestReport } from './ai-digest-report';
import { AiRunPoller } from './ai-run-poller';
import { AI_BUTTON_CLASS, AI_NEUTRAL_BUTTON_CLASS, AiArtifactDialog } from './ai-artifact-dialog';
import { readLatestDigest, startDigest } from '@/lib/ai-client';
import { digestToMarkdown } from '@/lib/ai-digest-markdown';
import { canRequestAiArtifact } from '@/lib/ai-run';
import { isDigestOutput, type DigestOutput } from '@/lib/ai-types';
import { useAiArtifactRun } from '@/lib/use-ai-artifact-run';

// The primary AI-digest affordance in the document header (DESIGN.md): a button
// that opens a panel, requests a run, polls it to a terminal status, and renders
// themes / contention points / consensus / action items with the run's own
// coverage line. Nothing here writes review data — a digest is a draft the
// author reads and copies (hard rule 5). Absent entirely when the instance has
// no Anthropic key: the surface is gated one level up.
//
// The run lifecycle, the dialog shell, and the poll loop are shared with the
// improve-the-doc prompt panel (#132) — this file owns only what a digest is.
export function AiDigestAction({ documentId, documentTitle }: { documentId: number; documentTitle: string }) {
  const t = useTranslations('ai-digest');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const { run, phase, inFlight, pending, failure, request, settle } = useAiArtifactRun({
    documentId,
    start: startDigest,
    readLatest: readLatestDigest,
  });

  const output = isDigestOutput(run?.output ?? null) ? (run?.output as DigestOutput) : null;

  async function copy(digest: DigestOutput) {
    try {
      await navigator.clipboard.writeText(
        digestToMarkdown(digest, {
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
      setCopyError(t('copyFailed'));
    }
  }

  const error = copyError ?? failure?.message ?? null;

  async function generate() {
    setCopyError(null);
    await request();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={AI_BUTTON_CLASS}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
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
            {phase === 'completed' && output ? (
              <button type="button" onClick={() => copy(output)} className={AI_NEUTRAL_BUTTON_CLASS}>
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

        {phase === 'completed' && output ? <AiDigestReport output={output} model={run?.model ?? null} /> : null}

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
