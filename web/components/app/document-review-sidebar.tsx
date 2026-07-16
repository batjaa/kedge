'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LifecycleStatus } from '@/lib/document-types';
import type { TocEntry } from '@/lib/review-surface-layout';
import type { ReviewThread } from '@/lib/thread-types';

export function DocumentReviewSidebar({
  tocEntries,
  activeHeadingId,
  threads,
  activeThreadId,
  sourceUrl,
  lifecycleStatus,
  versionLabel,
  onJumpToHeading,
  onFocusThread,
}: {
  tocEntries: TocEntry[];
  activeHeadingId: string | null;
  threads: ReviewThread[];
  activeThreadId: number | null;
  sourceUrl?: string | null;
  lifecycleStatus?: LifecycleStatus | null;
  versionLabel?: string | null;
  onJumpToHeading: (id: string) => void;
  onFocusThread: (thread: ReviewThread) => void;
}) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto border-r border-zinc-900/10 pr-6 dark:border-white/10">
        <div className="mb-4 flex min-w-0 items-center gap-2 text-xs font-mono">
          {versionLabel ? <MetaChip>{versionLabel}</MetaChip> : null}
          {lifecycleStatus ? <LifecycleChip status={lifecycleStatus} /> : null}
          {sourceUrl ? (
            <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{sourceUrl}</span>
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

        <div className="mt-8 rounded-2xl bg-rose-400/5 px-3 py-2.5 text-xs text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-semibold">Orphaned tray</span>
            <span className="ml-auto font-mono text-[9px] uppercase">empty</span>
          </div>
        </div>
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

function MetaChip({ children }: { children: string }) {
  return (
    <span className="rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700">
      {children}
    </span>
  );
}

function LifecycleChip({ status }: { status: LifecycleStatus }) {
  return (
    <span className="rounded-lg px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-600 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
      {status.replace('_', ' ')}
    </span>
  );
}
