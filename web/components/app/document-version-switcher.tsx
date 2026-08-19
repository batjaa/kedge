import Link from 'next/link';
import { ChevronDown, GitBranch } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { DocumentVersion } from '@/lib/document-types';
import { formatShortDate } from '@/lib/intl-time';
import { versionLabel } from '@/lib/version-label';

/**
 * How many trailing versions stay on the strip as pills (#141). Documents under
 * active review accumulate versions without bound, so the strip is capped and
 * everything older collapses behind one trigger.
 */
export const VISIBLE_VERSION_LIMIT = 3;

export function DocumentVersionSwitcher({
  documentId,
  versions,
  viewedVersionId,
  currentVersionId,
}: {
  documentId: number;
  versions: DocumentVersion[];
  viewedVersionId: number;
  currentVersionId: number;
}) {
  const t = useTranslations('review');
  const locale = useLocale();

  if (versions.length === 0) return null;

  const { pills, collapsed } = splitVersions(versions, viewedVersionId, currentVersionId);
  const compareBaseVersionId = compareBaseForVersions(versions, viewedVersionId, currentVersionId);

  return (
    // The positioned wrapper is what the overflow menu anchors to: its
    // containing block sits OUTSIDE the strip's `overflow-x-auto`, so the panel
    // is not clipped by it (the strip keeps the scroller as belt-and-braces).
    // `min-w-0 max-w-full` because this wrapper — not the nav — is now the flex
    // item in the header actions row: a flex item's automatic minimum size is
    // content-based, so without it the pills (all `shrink-0`) would push the
    // header wider instead of letting the strip's own scroller take over.
    <div className="relative min-w-0 max-w-full">
      <nav
        aria-label={t('versions.navLabel')}
        className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1 text-sm ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10"
      >
        <GitBranch className="ml-2 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
        {collapsed.length > 0 ? (
          // Native <details> disclosure: focusable summary, Enter/Space toggles,
          // real links inside stay in the tab order — accessible and
          // server-rendered with no client JS (the import-warnings idiom).
          <details className="group/older shrink-0">
            <summary
              className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-zinc-500 hover:bg-white/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
              aria-label={t('versions.olderLabel', { count: collapsed.length })}
            >
              <span>{t('versions.older', { count: collapsed.length })}</span>
              <ChevronDown
                className="h-3 w-3 transition-transform group-open/older:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-2xl bg-white p-1 shadow-md ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10">
              <ul aria-label={t('versions.olderListLabel')} className="flex flex-col">
                {collapsed.map((version) => {
                  const viewed = version.id === viewedVersionId;
                  const latest = version.id === currentVersionId;
                  const label = versionLabel(version) ?? `v${version.id}`;
                  const created = formatShortDate(version.synced_at, locale);

                  return (
                    <li key={version.id}>
                      <Link
                        href={`/documents/${documentId}?version=${version.id}`}
                        data-version-item={version.id}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                          viewed
                            ? 'bg-zinc-100 text-zinc-900 dark:bg-white/10 dark:text-white'
                            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100',
                        )}
                      >
                        <span className="font-mono text-[11px] font-semibold uppercase">{label}</span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {latest ? (
                            <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                              {t('versions.latest')}
                            </span>
                          ) : null}
                          {viewed ? (
                            <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                              {t('versions.viewing')}
                            </span>
                          ) : null}
                          {created ? (
                            <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{created}</span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        ) : null}
        {pills.map((version) => {
          const selected = version.id === viewedVersionId;
          const latest = version.id === currentVersionId;
          const label = versionLabel(version) ?? `v${version.id}`;

          return (
            <Link
              key={version.id}
              href={`/documents/${documentId}?version=${version.id}`}
              aria-current={selected ? 'page' : undefined}
              data-version-pill={version.id}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                selected
                  ? 'bg-white text-zinc-900 ring-1 ring-inset ring-zinc-900/10 dark:bg-zinc-900 dark:text-white dark:ring-white/10'
                  : 'text-zinc-500 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100',
              )}
            >
              <span>{label}</span>
              {latest ? <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{t('versions.latest')}</span> : null}
            </Link>
          );
        })}
        {compareBaseVersionId !== null ? (
          <Link
            href={`/documents/${documentId}/diff?a=${compareBaseVersionId}&b=${currentVersionId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-500/25 hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-300 dark:ring-emerald-400/25 dark:hover:bg-emerald-400/10"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            {t('versions.compare')}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

/**
 * Split the ascending version list into the pills the strip shows and the
 * versions the overflow menu collapses (#141).
 *
 * The window is the last {@link VISIBLE_VERSION_LIMIT} versions. Collapsing only
 * kicks in once it would hide at least two — hiding exactly one behind a trigger
 * costs a click and saves no width, so `limit + 1` versions still render whole.
 *
 * Two versions are then PINNED back onto the strip even when they fall outside
 * the window: the one being viewed (so `aria-current="page"` is always visible
 * without scrolling) and the current one (so the `latest` tag never hides).
 * `collapsed` still holds every out-of-window version — the trigger's count and
 * the menu's item count are the same number by construction.
 */
export function splitVersions(
  versions: DocumentVersion[],
  viewedVersionId: number,
  currentVersionId: number,
  limit: number = VISIBLE_VERSION_LIMIT,
): { pills: DocumentVersion[]; collapsed: DocumentVersion[] } {
  if (versions.length <= limit + 1) {
    return { pills: versions, collapsed: [] };
  }

  const windowStart = versions.length - limit;
  const older = versions.slice(0, windowStart);
  const pinned = older.filter(
    (version) => version.id === viewedVersionId || version.id === currentVersionId,
  );

  return {
    pills: [...pinned, ...versions.slice(windowStart)],
    // Newest first — the menu reads the opposite way round from the strip
    // because the version you most likely want back is the one nearest it.
    collapsed: [...older].reverse(),
  };
}

function compareBaseForVersions(
  versions: DocumentVersion[],
  viewedVersionId: number,
  currentVersionId: number,
): number | null {
  if (versions.length < 2) return null;
  if (viewedVersionId !== currentVersionId) return viewedVersionId;

  const currentIndex = versions.findIndex((version) => version.id === currentVersionId);
  const previous = currentIndex > 0 ? versions[currentIndex - 1] : null;

  return previous?.id ?? null;
}
