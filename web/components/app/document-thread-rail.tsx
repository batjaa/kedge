'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Link } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { ThreadCard } from './document-thread-card';
import { cn } from '@/lib/cn';
import { placeThreadCards, type ThreadPlacement } from '@/lib/review-surface-layout';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread, SuggestionStatus, ThreadComment, ThreadStatus } from '@/lib/thread-types';

const COLLAPSED_CARD_HEIGHT = 190;
const EXPANDED_CARD_HEIGHT = 390;

export type ReattachStatus = {
  threadId: number;
  tone: 'info' | 'error';
  message: string;
};

export function DocumentThreadRail({
  threads,
  page,
  lastPage,
  activeThreadId,
  highlightedThreadId,
  anchorPositions,
  documentHeight,
  onFocusThread,
  onActivateThread,
  onHoverThread,
  onLeaveThread,
  onLoadMore,
  onSetThreadStatus,
  onStartReattach,
  onReply,
  onForkComment,
  forkingCommentIds,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
  onToggleReaction,
  pendingReattachThreadId,
  reattachingThreadId,
  reattachStatus,
}: {
  threads: ReviewThread[];
  page: number;
  lastPage: number;
  activeThreadId: number | null;
  highlightedThreadId: number | null;
  anchorPositions: Record<number, number>;
  documentHeight: number;
  onFocusThread: (thread: ReviewThread) => void;
  onActivateThread: (thread: ReviewThread) => void;
  onHoverThread: (thread: ReviewThread) => void;
  onLeaveThread: () => void;
  onLoadMore: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onStartReattach: (thread: ReviewThread) => void;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  forkingCommentIds: ReadonlySet<number>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
  onToggleReaction: (comment: ThreadComment) => Promise<string | null>;
  pendingReattachThreadId: number | null;
  reattachingThreadId: number | null;
  reattachStatus: ReattachStatus | null;
}) {
  const t = useTranslations('threads');
  const [cardHeights, setCardHeights] = useState<Record<number, number>>({});
  const [footerHeight, setFooterHeight] = useState(128);
  const railThreads = useMemo(
    () => threads.filter((thread) => thread.anchor?.state !== 'orphaned'),
    [threads],
  );
  const orphanedThreads = useMemo(
    () => threads.filter((thread) => thread.anchor?.state === 'orphaned'),
    [threads],
  );
  const fallbackCardHeight = (threadId: number) => activeThreadId === threadId ? EXPANDED_CARD_HEIGHT : COLLAPSED_CARD_HEIGHT;
  const placements = useMemo(() => {
    return placeThreadCards(railThreads.map((thread) => ({
      threadId: thread.id,
      anchorY: thread.anchor ? anchorPositions[thread.id] ?? null : null,
      height: cardHeights[thread.id] ?? fallbackCardHeight(thread.id),
    })), { minGap: 18 });
  }, [activeThreadId, anchorPositions, cardHeights, railThreads]);
  const placementByThread = useMemo(() => {
    return new Map(placements.map((placement) => [placement.threadId, placement]));
  }, [placements]);
  const cardStackBottom = placements.length === 0
    ? 0
    : Math.max(...placements.map((placement) => placement.y + (cardHeights[placement.threadId] ?? fallbackCardHeight(placement.threadId)) + 32));
  const railHeight = Math.max(
    documentHeight,
    320,
    cardStackBottom + footerHeight,
  );
  const footerTop = Math.max(0, railHeight - footerHeight);

  return (
    <aside className="relative hidden xl:block" data-review-rail aria-label={t('rail.label')}>
      <div className="relative" style={{ minHeight: railHeight }}>
        {railThreads.map((thread) => {
          const placement = placementByThread.get(thread.id);
          if (!placement) return null;
          const expanded = activeThreadId === thread.id;
          const highlighted = highlightedThreadId === thread.id;

          return (
            <MeasuredThreadCard
              key={thread.id}
              placement={placement}
              onMeasure={(height) => {
                setCardHeights((current) => current[thread.id] === height ? current : { ...current, [thread.id]: height });
              }}
            >
              <ThreadConnector placement={placement} active={highlighted} />
              <ThreadCard
                thread={thread}
                active={highlighted}
                expanded={expanded}
                onFocusThread={onFocusThread}
                onActivateThread={onActivateThread}
                onHoverThread={onHoverThread}
                onLeaveThread={onLeaveThread}
                onSetThreadStatus={onSetThreadStatus}
                onReply={onReply}
                onForkComment={onForkComment}
                forkingCommentIds={forkingCommentIds}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onSetSuggestionStatus={onSetSuggestionStatus}
                onToggleReaction={onToggleReaction}
              />
            </MeasuredThreadCard>
          );
        })}
        {railThreads.length === 0 && orphanedThreads.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t('rail.empty')}
          </p>
        ) : null}
        <MeasuredRailFooter
          top={footerTop}
          onMeasure={(height) => {
            setFooterHeight((current) => current === height ? current : height);
          }}
        >
          {page < lastPage ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="w-full rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
            >
              {t('rail.loadMore')}
            </button>
          ) : null}

          <OrphanedTray
            threads={orphanedThreads}
            activeThreadId={activeThreadId}
            onFocusThread={onFocusThread}
            onActivateThread={onActivateThread}
            onHoverThread={onHoverThread}
            onLeaveThread={onLeaveThread}
            onSetThreadStatus={onSetThreadStatus}
            onStartReattach={onStartReattach}
            onReply={onReply}
            onForkComment={onForkComment}
            forkingCommentIds={forkingCommentIds}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            onSetSuggestionStatus={onSetSuggestionStatus}
            onToggleReaction={onToggleReaction}
            pendingReattachThreadId={pendingReattachThreadId}
            reattachingThreadId={reattachingThreadId}
            reattachStatus={reattachStatus}
          />
        </MeasuredRailFooter>
      </div>
    </aside>
  );
}

function MeasuredThreadCard({
  placement,
  onMeasure,
  children,
}: {
  placement: ThreadPlacement;
  onMeasure: (height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measuredNode = node;

    function measure() {
      const height = Math.ceil(measuredNode.getBoundingClientRect().height);
      if (height > 0) onMeasure(height);
    }

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(measuredNode);

    return () => observer.disconnect();
  }, [onMeasure]);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0"
      style={{ top: placement.y }}
    >
      {children}
    </div>
  );
}

function MeasuredRailFooter({
  top,
  onMeasure,
  children,
}: {
  top: number;
  onMeasure: (height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measuredNode = node;

    function measure() {
      const height = Math.ceil(measuredNode.getBoundingClientRect().height);
      if (height > 0) onMeasure(height);
    }

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(measuredNode);

    return () => observer.disconnect();
  }, [onMeasure]);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 space-y-4"
      style={{ top }}
    >
      {children}
    </div>
  );
}

function ThreadConnector({ placement, active }: { placement: ThreadPlacement; active: boolean }) {
  if (placement.connectorOffset === null) return null;

  const cardAttachOffset = 18;
  const horizontalTop = placement.connectorOffset;
  const verticalTop = Math.min(horizontalTop, cardAttachOffset);
  const verticalHeight = Math.abs(horizontalTop - cardAttachOffset);
  const tone = active ? 'bg-emerald-500/70 dark:bg-emerald-400/70' : 'bg-zinc-300 dark:bg-zinc-700';

  return (
    <span aria-hidden="true" className="pointer-events-none absolute -left-10 top-0 block">
      <span
        className={`absolute left-0 h-px w-10 ${tone}`}
        style={{ top: horizontalTop }}
      />
      {verticalHeight > 1 ? (
        <span
          className={`absolute left-0 w-px ${tone}`}
          style={{ top: verticalTop, height: verticalHeight }}
        />
      ) : null}
    </span>
  );
}

function OrphanedTray({
  threads,
  activeThreadId,
  onFocusThread,
  onActivateThread,
  onHoverThread,
  onLeaveThread,
  onSetThreadStatus,
  onStartReattach,
  onReply,
  onForkComment,
  forkingCommentIds,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
  onToggleReaction,
  pendingReattachThreadId,
  reattachingThreadId,
  reattachStatus,
}: {
  threads: ReviewThread[];
  activeThreadId: number | null;
  onFocusThread: (thread: ReviewThread) => void;
  onActivateThread: (thread: ReviewThread) => void;
  onHoverThread: (thread: ReviewThread) => void;
  onLeaveThread: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onStartReattach: (thread: ReviewThread) => void;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  forkingCommentIds: ReadonlySet<number>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
  onToggleReaction: (comment: ThreadComment) => Promise<string | null>;
  pendingReattachThreadId: number | null;
  reattachingThreadId: number | null;
  reattachStatus: ReattachStatus | null;
}) {
  const t = useTranslations('threads');
  const format = useFormatter();

  return (
    <section
      id="orphaned-threads"
      aria-label={t('orphan.label')}
      className="rounded-2xl bg-rose-400/5 p-4 text-sm ring-1 ring-inset ring-rose-500/20"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <h2 className="text-xs font-semibold text-rose-700 dark:text-rose-300">{t('orphan.title')}</h2>
        <span className="ml-auto rounded-lg bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/30">
          {threads.length === 0 ? t('orphan.empty') : format.number(threads.length)}
        </span>
      </div>
      {threads.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-rose-700/80 dark:text-rose-300/80">
          {t('orphan.emptyBody')}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {threads.map((thread) => {
            const threadReattachStatus = reattachStatus?.threadId === thread.id ? reattachStatus : null;

            return (
              <div
                key={thread.id}
                className="space-y-2 rounded-md border border-rose-500/20 bg-white/70 p-2 dark:bg-zinc-950/30"
              >
                <p className="px-1 text-[11px] font-semibold uppercase text-rose-700 dark:text-rose-300">
                  {t('orphan.itemLabel')}
                </p>
                {thread.can_reanchor ? (
                  <button
                    type="button"
                    title={t('orphan.selectHint')}
                    disabled={reattachingThreadId === thread.id}
                    onClick={() => onStartReattach(thread)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-rose-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-1 dark:ring-inset dark:ring-rose-300/20 dark:hover:bg-rose-400/15"
                  >
                    <Link className="h-3.5 w-3.5" aria-hidden="true" />
                    {reattachingThreadId === thread.id
                      ? t('orphan.reattaching')
                      : pendingReattachThreadId === thread.id
                        ? t('orphan.selectText')
                        : t('orphan.reattach')}
                  </button>
                ) : null}
                {threadReattachStatus ? (
                  <p
                    role={threadReattachStatus.tone === 'error' ? 'alert' : 'status'}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs leading-5 ring-1 ring-inset',
                      threadReattachStatus.tone === 'error'
                        ? 'bg-rose-50 text-rose-700 ring-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/20'
                        : 'bg-white/70 text-rose-700 ring-rose-500/20 dark:bg-zinc-950/30 dark:text-rose-200 dark:ring-rose-300/20',
                    )}
                  >
                    {threadReattachStatus.message}
                  </p>
                ) : null}
                <ThreadCard
                  thread={thread}
                  active={activeThreadId === thread.id}
                  expanded={activeThreadId === thread.id}
                  onFocusThread={onFocusThread}
                  onActivateThread={onActivateThread}
                  onHoverThread={onHoverThread}
                  onLeaveThread={onLeaveThread}
                  onSetThreadStatus={onSetThreadStatus}
                  onReply={onReply}
                  onForkComment={onForkComment}
                  forkingCommentIds={forkingCommentIds}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  onSetSuggestionStatus={onSetSuggestionStatus}
                  onToggleReaction={onToggleReaction}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
