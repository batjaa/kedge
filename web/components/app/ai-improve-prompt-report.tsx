'use client';

import { useTranslations } from 'next-intl';
import type { ImprovePromptOutput } from '@/lib/ai-types';

/**
 * The improve-the-doc prompt as the panel shows it (SPEC §14, user story 4):
 * the run's coverage line, what the artifact speaks for, and the artifact
 * itself — rendered as preformatted text, never re-flowed.
 *
 * The prompt is shown EXACTLY as the run stored it. It carries accepted
 * suggested edits verbatim, so a "helpful" reformat here would corrupt the one
 * thing this artifact promises. Same rule as the coverage sentence, which is
 * printed as the server wrote it and never re-derived.
 *
 * Presentational and state-free, so it renders identically in the panel and in a
 * test.
 */
export function AiImprovePromptReport({
  output,
  model,
}: {
  output: ImprovePromptOutput;
  model: string | null;
}) {
  const t = useTranslations('ai-improve-prompt');
  const empty = output.prompt.trim() === '';

  return (
    <div>
      <p className="rounded-xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
        {output.coverage.statement}
      </p>

      {empty ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t('nothingToAsk')}</p>
      ) : (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('stats', { threads: output.threads, edits: output.required_edits })}
          </p>

          <pre
            aria-label={t('artifactLabel')}
            className="mt-2 max-h-96 overflow-auto rounded-xl bg-zinc-50 p-3.5 text-xs whitespace-pre-wrap break-words text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-white/10"
          >
            {output.prompt}
          </pre>
        </>
      )}

      {/* Hard rule 5, said out loud: the AI drafted, nothing was posted. */}
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        {model ? t('draftNoticeWithModel', { model }) : t('draftNotice')}
      </p>
    </div>
  );
}
