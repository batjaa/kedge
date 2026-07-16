'use client';

import { MessageSquare, Send } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureAnchorFromSelection } from '@/lib/anchor-capture-dom';
import { createThread, listThreads } from '@/lib/comments-client';
import { PROJECTION_RANGE_ATTR } from '@/lib/projection';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import type { AnchorCaptureFailure, AnchorSelector } from '@/lib/anchor-capture-core';
import type { ReviewThread, ThreadAnchor } from '@/lib/thread-types';

const BASE_ANCHOR_CLASSES = ['bg-emerald-300/20', 'ring-1', 'ring-inset', 'ring-emerald-400/20'];
const ACTIVE_ANCHOR_CLASSES = ['bg-emerald-300/40', 'ring-2', 'ring-emerald-500/60'];

type ComposerState =
  | { open: false }
  | {
      open: true;
      stage: 'affordance' | 'panel';
      mode: 'inline' | 'document';
      anchor: AnchorSelector | null;
      failure: AnchorCaptureFailure | null;
      x: number;
      y: number;
      idempotencyKey: string;
    };

export function DocumentReviewSurface({
  documentId,
  plainText,
  projectionVersion,
  children,
}: {
  documentId: number;
  plainText: string | null;
  projectionVersion: string | null;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [composer, setComposer] = useState<ComposerState>({ open: false });
  const [body, setBody] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const numericProjectionVersion = projectionVersion == null ? NaN : Number(projectionVersion);
  const canCapture = plainText != null && Number.isFinite(numericProjectionVersion);

  const reloadThreads = useCallback(async (nextPage = 1) => {
    const result = await listThreads(documentId, nextPage);
    setThreads((current) => (nextPage === 1 ? result.data : [...current, ...result.data]));
    setPage(result.meta?.current_page ?? nextPage);
    setLastPage(result.meta?.last_page ?? nextPage);
  }, [documentId]);

  useEffect(() => {
    void reloadThreads(1);
  }, [reloadThreads]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    decorateAnchors(root, threads, activeThreadId);
  }, [threads, activeThreadId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function over(event: MouseEvent) {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-kedge-thread-ids]')
        : null;
      const id = target?.dataset.kedgeThreadIds?.split(',')[0];
      if (id) setActiveThreadId(Number(id));
    }

    function out(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('[data-kedge-thread-ids]')) {
        setActiveThreadId(null);
      }
    }

    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
    };
  }, []);

  function captureSelection() {
    if (!canCapture || !rootRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setComposer({ open: false });
      return;
    }

    const range = selection.getRangeAt(0);
    if (!rootRef.current.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const result = captureAnchorFromSelection({
      root: rootRef.current,
      plainText,
      projectionVersion: numericProjectionVersion,
      selection,
    });

    const base = {
      open: true as const,
      stage: 'affordance' as const,
      x: Math.min(window.innerWidth - 180, Math.max(16, rect.left + rect.width / 2)),
      y: Math.max(16, rect.top - 44),
      idempotencyKey: newIdempotencyKey(),
    };

    if (result.ok) {
      setComposer({ ...base, mode: 'inline', anchor: result.selector, failure: null });
    } else {
      console.warn('anchor capture failed', result);
      setComposer({ ...base, mode: 'document', anchor: null, failure: result });
    }
  }

  async function submit() {
    if (!composer.open || body.trim() === '') return;
    setMessage(null);

    const outcome = composer.mode === 'inline' && composer.anchor
      ? await createThread(documentId, {
          type: 'inline',
          body,
          anchor: {
            ...composer.anchor,
            projection_version: String(composer.anchor.projection_version),
          },
          idempotency_key: composer.idempotencyKey,
        })
      : await createThread(documentId, {
          type: 'document',
          body,
          failed_capture: composer.failure != null,
          idempotency_key: composer.idempotencyKey,
        });

    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }

    setBody('');
    setComposer({ open: false });
    window.getSelection()?.removeAllRanges();
    await reloadThreads(1);
    setActiveThreadId(outcome.thread.id);
  }

  function focusThread(thread: ReviewThread) {
    setActiveThreadId(thread.id);
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-kedge-thread-ids~="${thread.id}"]`)
      ?? firstElementForThread(root, thread.id);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => setActiveThreadId(null), 1800);
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div
        ref={rootRef}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        className="min-w-0"
      >
        {children}
      </div>

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
            onFocus={() => focusThread(thread)}
            onHover={() => setActiveThreadId(thread.id)}
            onLeave={() => setActiveThreadId(null)}
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
            onClick={() => void reloadThreads(page + 1)}
            className="w-full rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-white/5"
          >
            Load more
          </button>
        ) : null}
      </aside>

      {composer.open && composer.stage === 'panel' ? (
        <div
          className="fixed z-50 w-[min(360px,calc(100vw-2rem))] rounded-lg bg-white p-3 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
          style={{ left: composer.x, top: composer.y, transform: 'translateX(-50%)' }}
        >
          {composer.failure ? (
            <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              Selection could not be anchored. Comment on the whole document instead.
            </div>
          ) : null}
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            className="block w-full resize-none rounded-lg border-0 bg-zinc-50 p-3 text-sm leading-6 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700"
            placeholder="Write a comment"
          />
          {message ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setComposer({ open: false })}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={body.trim() === ''}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Post
            </button>
          </div>
        </div>
      ) : null}

      {composer.open && composer.stage === 'affordance' ? (
        <button
          type="button"
          onClick={() => setComposer({ ...composer, stage: 'panel' })}
          className="fixed z-50 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/10 hover:bg-zinc-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          style={{ left: composer.x, top: composer.y, transform: 'translateX(-50%)' }}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Comment
        </button>
      ) : null}
    </div>
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

function decorateAnchors(root: HTMLElement, threads: ReviewThread[], activeThreadId: number | null) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-kedge-thread-ids]')) {
    element.removeAttribute('data-kedge-thread-ids');
    element.classList.remove(...BASE_ANCHOR_CLASSES, ...ACTIVE_ANCHOR_CLASSES);
  }

  const inlineThreads = threads.filter((thread) => thread.anchor);
  if (inlineThreads.length === 0) return;

  for (const element of root.querySelectorAll<HTMLElement>(`[${PROJECTION_RANGE_ATTR}]`)) {
    const range = parseRange(element.getAttribute(PROJECTION_RANGE_ATTR));
    if (!range) continue;

    const matching = inlineThreads.filter((thread) => {
      const anchor = thread.anchor;
      return anchor && overlaps(range.start, range.end, anchor.start, anchor.end);
    });
    if (matching.length === 0) continue;

    element.dataset.kedgeThreadIds = matching.map((thread) => String(thread.id)).join(',');
    element.classList.add(...BASE_ANCHOR_CLASSES);
    if (activeThreadId != null && matching.some((thread) => thread.id === activeThreadId)) {
      element.classList.add(...ACTIVE_ANCHOR_CLASSES);
    }
  }
}

function firstElementForThread(root: HTMLElement | null, threadId: number): HTMLElement | null {
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>('[data-kedge-thread-ids]')) {
    if (element.dataset.kedgeThreadIds?.split(',').includes(String(threadId))) {
      return element;
    }
  }
  return null;
}

function parseRange(raw: string | null): { start: number; end: number } | null {
  const match = raw?.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

function overlaps(start: number, end: number, anchorStart: number, anchorEnd: number): boolean {
  return start < anchorEnd && anchorStart < end;
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

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
