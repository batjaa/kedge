import { useTranslations } from 'next-intl';
import type { ImportWarning } from '@/lib/document-types';

// The author-facing import warning list (SPEC 5.2, §19). Anything that didn't
// survive normalization — a failed image fetch, a degraded HTML conversion —
// shows here, honestly, never silently. A collapsed amber panel following the
// DESIGN.md callout anatomy (rounded-2xl, hairline ring, status hue amber);
// native <details> keeps it accessible and server-rendered with no client JS.
export function ImportWarnings({ warnings }: { warnings: ImportWarning[] }) {
  // Chrome from the imports catalog (M3.9); each warning's `message` is API
  // prose and passes through untranslated (the code-mapping path is future
  // work on the sync_error_code debt item).
  const t = useTranslations('imports');

  if (warnings.length === 0) return null;

  const count = warnings.length;

  return (
    <details className="group mb-6 rounded-2xl bg-amber-50/60 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/5 dark:ring-amber-400/20">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {t('warnings.count', { count })}
        </span>
        <span className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-700/70 dark:text-amber-300/70">
          <span className="group-open:hidden">{t('warnings.show')}</span>
          <span className="hidden group-open:inline">{t('warnings.hide')}</span>
        </span>
      </summary>
      <ul className="space-y-2.5 border-t border-amber-500/15 px-4 py-3">
        {warnings.map((warning, index) => (
          <li
            key={index}
            className="flex gap-2.5 text-sm leading-6 text-amber-900/80 dark:text-amber-100/70"
          >
            <span
              aria-hidden="true"
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70"
            />
            <span>{warning.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
