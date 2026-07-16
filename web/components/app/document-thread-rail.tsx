'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ThreadCard } from './document-thread-card';
import { placeThreadCards, type ThreadPlacement } from '@/lib/review-surface-layout';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread, SuggestionStatus, ThreadComment, ThreadStatus } from '@/lib/thread-types';

const COLLAPSED_CARD_HEIGHT = 190;
const EXPANDED_CARD_HEIGHT = 390;

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
  onReply,
  onForkComment,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
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
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
}) {
  const [cardHeights, setCardHeights] = useState<Record<number, number>>({});
  const [footerHeight, setFooterHeight] = useState(128);
  const fallbackCardHeight = (threadId: number) => activeThreadId === threadId ? EXPANDED_CARD_HEIGHT : COLLAPSED_CARD_HEIGHT;
  const placements = useMemo(() => {
    return placeThreadCards(threads.map((thread) => ({
      threadId: thread.id,
      anchorY: thread.anchor ? anchorPositions[thread.id] ?? null : null,
      height: cardHeights[thread.id] ?? fallbackCardHeight(thread.id),
    })), { minGap: 18 });
  }, [activeThreadId, anchorPositions, cardHeights, threads]);
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
    <aside className="relative hidden xl:block" data-review-rail aria-label="Thread rail">
      <div className="relative" style={{ minHeight: railHeight }}>
        {threads.map((thread) => {
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
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onSetSuggestionStatus={onSetSuggestionStatus}
              />
            </MeasuredThreadCard>
          );
        })}
        {threads.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No threads yet.
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
              Load more threads
            </button>
          ) : null}

          <OrphanedTray />
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

function OrphanedTray() {
  return (
    <section
      id="orphaned-threads"
      aria-label="Orphaned threads"
      className="rounded-2xl bg-rose-400/5 p-4 text-sm ring-1 ring-inset ring-rose-500/20"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <h2 className="text-xs font-semibold text-rose-700 dark:text-rose-300">Orphaned tray</h2>
        <span className="ml-auto rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-rose-600 ring-1 ring-inset ring-rose-400/30 dark:text-rose-400">
          empty
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-rose-700/80 dark:text-rose-300/80">
        No orphaned threads yet.
      </p>
    </section>
  );
}
