'use client';

import { PanelLeftClose } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MetaChip } from './meta-chip';
import { cn } from '@/lib/cn';
import type { LifecycleStatus } from '@/lib/document-types';
import type { TocEntry } from '@/lib/review-surface-layout';
import type { ReviewThread } from '@/lib/thread-types';

export function DocumentReviewSidebar({
  tocEntries,
  activeHeadingId,
  threads,
  activeThreadId,
  lifecycleStatus,
  versionLabel,
  onJumpToHeading,
  onFocusThread,
  onCollapse,
}: {
  tocEntries: TocEntry[];
  activeHeadingId: string | null;
  threads: ReviewThread[];
  activeThreadId: number | null;
  lifecycleStatus?: LifecycleStatus | null;
  versionLabel?: string | null;
  onJumpToHeading: (id: string) => void;
  onFocusThread: (thread: ReviewThread) => void;
  onCollapse?: () => void;
}) {
  const t = useTranslations('review');

  return (
    // The sticky box IS the root, deliberately (#146). A sticky element can only
    // travel inside its containing block, so wrapping it in an auto-height
    // <aside> gave it exactly its own height of slack — zero — and it scrolled
    // away with the document. As the root it sits directly in the stretched
    // `w-72` flex column of DocumentReviewSurface, whose height is the whole
    // review row, so it pins for the length of the document.
    //
    // `--kedge-pin-top` is where it pins: the measured bottom edge of the
    // document header, published by the surface on the review row (a constant
    // cannot track a header that grows an approvals roster). The 8rem fallback
    // covers the server render, before the measurement exists.
    <aside
      data-review-sidebar
      className="sticky top-[var(--kedge-pin-top,8rem)] max-h-[calc(100vh-var(--kedge-pin-top,8rem)-1rem)] overflow-y-auto border-r border-zinc-900/10 py-8 pl-6 pr-6 dark:border-white/10"
    >
      <div className="mb-4 flex min-w-0 items-center gap-2 text-xs font-mono">
        {versionLabel ? <MetaChip>{versionLabel}</MetaChip> : null}
        {lifecycleStatus ? <LifecycleChip status={lifecycleStatus} /> : null}
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('sidebar.hide')}
            title={t('sidebar.hide')}
            className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <h2 className="text-xs font-semibold text-zinc-900 dark:text-white">{t('sidebar.document')}</h2>
      <nav className="mt-3 border-l border-zinc-900/10 text-sm dark:border-white/10" aria-label={t('sidebar.tocLabel')}>
        {tocEntries.length > 0 ? (
          tocEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onJumpToHeading(entry.id)}
              className={cn(
                'block w-full -ml-px border-l-2 py-1 text-left hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-white',
                entry.level > 2 ? 'pl-7 text-xs' : 'pl-4',
                activeHeadingId === entry.id
                  ? 'border-emerald-500 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-600 hover:border-zinc-300 dark:text-zinc-400 dark:hover:border-zinc-600',
              )}
            >
              {entry.title}
            </button>
          ))
        ) : (
          <p className="pl-4 text-xs leading-5 text-zinc-500 dark:text-zinc-500">{t('sidebar.noHeadings')}</p>
        )}
      </nav>

      <h2 className="mt-8 text-xs font-semibold text-zinc-900 dark:text-white">{t('sidebar.threads')}</h2>
      <nav className="mt-3 border-l border-zinc-900/10 text-sm dark:border-white/10" aria-label={t('sidebar.threads')}>
        {threads.length > 0 ? (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onFocusThread(thread)}
              className={cn(
                'flex w-full -ml-px items-center gap-2 rounded-r border-l-2 py-1 pl-4 text-left hover:bg-zinc-50 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/[.03] dark:hover:text-white',
                activeThreadId === thread.id
                  ? 'border-emerald-500 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{threadNavLabel(thread, t)}</span>
              <ThreadStatusLabel thread={thread} />
            </button>
          ))
        ) : (
          <p className="pl-4 text-xs leading-5 text-zinc-500 dark:text-zinc-500">{t('sidebar.noThreads')}</p>
        )}
      </nav>

      <a
        href="#orphaned-threads"
        className="mt-8 inline-flex text-xs font-medium text-rose-700 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-rose-300 dark:hover:text-rose-200"
      >
        {t('sidebar.orphanedThreads')}
      </a>
    </aside>
  );
}

function threadNavLabel(thread: ReviewThread, t: ReturnType<typeof useTranslations>): string {
  const quote = thread.anchor?.exact.trim();
  if (quote) return quote;

  const body = thread.first_comment?.body_md?.replace(/\s+/g, ' ').trim();
  if (body) return body;

  return thread.type === 'document' ? t('sidebar.documentThread') : t('sidebar.inlineThread');
}

function ThreadStatusLabel({ thread }: { thread: ReviewThread }) {
  const t = useTranslations('review');
  const firstComment = thread.first_comment;
  const isSuggestion = firstComment?.type === 'suggestion';
  const isAgent = firstComment?.client === 'mcp';
  const label = isAgent
    ? t('sidebar.navStatus.agent')
    : isSuggestion
      ? t('sidebar.navStatus.suggestion')
      : thread.status === 'resolved'
        ? t('sidebar.navStatus.resolved')
        : t('sidebar.navStatus.open');
  const classes = isAgent
    ? 'text-violet-600 dark:text-violet-400'
    : isSuggestion
      ? 'text-amber-600 dark:text-amber-400'
      : thread.status === 'resolved'
        ? 'text-zinc-400 dark:text-zinc-500'
        : 'text-emerald-600 dark:text-emerald-400';

  return (
    <span className={cn('font-mono text-[9px] font-semibold uppercase', classes)}>
      {label}
    </span>
  );
}

function LifecycleChip({ status }: { status: LifecycleStatus }) {
  // Lifecycle labels are the constrained chip glossary (eng-review 13A) — read
  // them from the shared `chips` namespace so this chip never drifts from the
  // header's StatusChip, and stays inside the truncation budget.
  const t = useTranslations('chips');

  return (
    <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30">
      {t(`lifecycle.${status}`)}
    </span>
  );
}
