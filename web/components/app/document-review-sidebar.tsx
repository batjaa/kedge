'use client';

import { PanelLeftClose } from 'lucide-react';
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
  return (
    <aside>
      <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto border-r border-zinc-900/10 py-8 pl-6 pr-6 dark:border-white/10">
        <div className="mb-4 flex min-w-0 items-center gap-2 text-xs font-mono">
          {versionLabel ? <MetaChip>{versionLabel}</MetaChip> : null}
          {lifecycleStatus ? <LifecycleChip status={lifecycleStatus} /> : null}
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Hide contents and threads"
              title="Hide contents and threads"
              className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <h2 className="text-xs font-semibold text-zinc-900 dark:text-white">Document</h2>
        <nav className="mt-3 border-l border-zinc-900/10 text-sm dark:border-white/10" aria-label="Document table of contents">
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
            <p className="pl-4 text-xs leading-5 text-zinc-500 dark:text-zinc-500">No headings</p>
          )}
        </nav>

        <h2 className="mt-8 text-xs font-semibold text-zinc-900 dark:text-white">Threads</h2>
        <nav className="mt-3 border-l border-zinc-900/10 text-sm dark:border-white/10" aria-label="Threads">
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
                <span className="min-w-0 flex-1 truncate">{threadNavLabel(thread)}</span>
                <ThreadStatusLabel thread={thread} />
              </button>
            ))
          ) : (
            <p className="pl-4 text-xs leading-5 text-zinc-500 dark:text-zinc-500">No threads</p>
          )}
        </nav>

        <a
          href="#orphaned-threads"
          className="mt-8 inline-flex text-xs font-medium text-rose-700 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-rose-300 dark:hover:text-rose-200"
        >
          Orphaned threads
        </a>
      </div>
    </aside>
  );
}

function threadNavLabel(thread: ReviewThread): string {
  const quote = thread.anchor?.exact.trim();
  if (quote) return quote;

  const body = thread.first_comment?.body_md?.replace(/\s+/g, ' ').trim();
  if (body) return body;

  return thread.type === 'document' ? 'Document thread' : 'Inline thread';
}

function ThreadStatusLabel({ thread }: { thread: ReviewThread }) {
  const firstComment = thread.first_comment;
  const isSuggestion = firstComment?.type === 'suggestion';
  const isAgent = firstComment?.client === 'mcp';
  const label = isAgent ? 'agent' : isSuggestion ? 'sugg' : thread.status === 'resolved' ? 'done' : 'open';
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
  return (
    <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30">
      {status.replace('_', ' ')}
    </span>
  );
}
