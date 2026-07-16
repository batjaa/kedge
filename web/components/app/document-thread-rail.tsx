'use client';

import { useMemo } from 'react';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import type { ReviewThread, ThreadAnchor } from '@/lib/thread-types';

export function DocumentThreadRail({
  threads,
  page,
  lastPage,
  activeThreadId,
  onFocusThread,
  onHoverThread,
  onLeaveThread,
  onLoadMore,
}: {
  threads: ReviewThread[];
  page: number;
  lastPage: number;
  activeThreadId: number | null;
  onFocusThread: (thread: ReviewThread) => void;
  onHoverThread: (thread: ReviewThread) => void;
  onLeaveThread: () => void;
  onLoadMore: () => void;
}) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto" data-review-rail>
      <div className="flex items-center justify-between border-b border-zinc-900/10 pb-2 dark:border-white/10">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Threads</h2>
        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{threads.length}</span>
      </div>
      {threads.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          active={activeThreadId === thread.id}
          onFocus={() => onFocusThread(thread)}
          onHover={() => onHoverThread(thread)}
          onLeave={onLeaveThread}
        />
      ))}
      {threads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No threads yet.
        </p>
      ) : null}
      {page < lastPage ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-white/5"
        >
          Load more
        </button>
      ) : null}
    </aside>
  );
}

function ThreadCard({
  thread,
  active,
  onFocus,
  onHover,
  onLeave,
}: {
  thread: ReviewThread;
  active: boolean;
  onFocus: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  const author = thread.first_comment?.author?.name ?? 'Reviewer';
  const body = useMemo(
    () => renderCommentMarkdown(thread.first_comment?.body_md ?? ''),
    [thread.first_comment?.body_md],
  );

  return (
    <article
      id={`thread-card-${thread.id}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={[
        'rounded-lg bg-white p-4 ring-1 transition dark:bg-white/[.03]',
        active ? 'ring-emerald-500/60 shadow-sm' : 'ring-zinc-900/10 dark:ring-white/10',
      ].join(' ')}
    >
      <button type="button" onClick={onFocus} className="block w-full text-left">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">{thread.type === 'inline' ? 'Inline' : 'Document'}</span>
          <span className="rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300">
            {thread.status}
          </span>
          <span className="ml-auto text-[10px] text-zinc-400">{relativeTime(thread.latest_activity_at)}</span>
        </div>
        {thread.anchor ? <Quote anchor={thread.anchor} /> : null}
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[9px] font-medium text-white">
            {initials(author)}
          </span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{author}</span>
          {thread.comment_count > 1 ? <span>{thread.comment_count} comments</span> : null}
        </div>
        <div className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{body}</div>
      </button>
    </article>
  );
}

function Quote({ anchor }: { anchor: ThreadAnchor }) {
  return (
    <blockquote className="mt-3 border-l-2 border-emerald-500/40 pl-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
      {anchor.exact}
    </blockquote>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function relativeTime(value: string | null): string {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
