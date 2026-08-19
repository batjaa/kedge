'use client';

import { useTranslations } from 'next-intl';
import type { DigestEntry, DigestOutput } from '@/lib/ai-types';

/**
 * The rendered digest (SPEC §14.1): four lists, plus the run's own coverage
 * line. The coverage sentence is printed VERBATIM from the run — the web never
 * re-derives it, so an honest "covers 12 of 20 threads" can never be prettified
 * into a lie by a formatting change here.
 *
 * Presentational and state-free, so it renders identically in the panel and in a
 * test.
 */
export function AiDigestReport({ output, model }: { output: DigestOutput; model: string | null }) {
  const t = useTranslations('ai-digest');

  const sections: Array<[string, DigestEntry[]]> = [
    [t('sections.themes'), output.themes],
    [t('sections.contentionPoints'), output.contention_points],
    [t('sections.consensus'), output.consensus],
    [t('sections.actionItems'), output.action_items],
  ];

  return (
    <div>
      <p className="rounded-xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
        {output.coverage.statement}
      </p>

      <div className="mt-4 space-y-4">
        {sections.map(([heading, entries]) => (
          <section key={heading}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {heading}
            </h3>
            {entries.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">{t('empty')}</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {entries.map((entry, index) => (
                  <li key={`${heading}-${index}`} className="text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="font-medium text-zinc-900 dark:text-white">{entry.title}</span>
                    {' — '}
                    {entry.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Hard rule 5, said out loud: the AI drafted, nothing was posted. */}
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        {model ? t('draftNoticeWithModel', { model }) : t('draftNotice')}
      </p>
    </div>
  );
}
