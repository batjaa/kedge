'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { DocumentCommentComposer, type ComposerState } from './document-comment-composer';
import { DocumentReviewHeader } from './document-review-header';
import { DocumentReviewSidebar } from './document-review-sidebar';
import { DocumentThreadRail } from './document-thread-rail';
import { MobileThreadSheet } from './mobile-thread-sheet';
import { captureAnchorFromSelection } from '@/lib/anchor-capture-dom';
import { commentComposerSubmitState } from '@/lib/comment-composer';
import { postDocumentComposerDraft } from '@/lib/comment-composer-actions';
import { createCommentForkGuard, type CommentForkGuard } from '@/lib/comment-fork-guard';
import {
  createSuggestionThread,
  createThread,
  deleteComment,
  editComment,
  forkComment,
  listThreads,
  replyToThread,
  updateSuggestionStatus,
  updateThreadStatus,
  type ReplyToThreadInput,
} from '@/lib/comments-client';
import {
  decorateAnchorHighlights,
  firstAnchorHighlightForThread,
  threadIdsFromAttribute,
} from '@/lib/anchor-highlight-dom';
import {
  commentDraftContextKey,
  newCommentDraftIdempotencyKey,
  useCommentDraft,
} from '@/lib/comment-draft';
import {
  activeHeadingIdForScroll,
  deriveTocEntriesFromHeadings,
  type HeadingPosition,
  type TocEntry,
} from '@/lib/review-surface-layout';
import type { LifecycleStatus } from '@/lib/document-types';
import type { ReviewThread, SuggestionStatus, ThreadComment, ThreadStatus } from '@/lib/thread-types';

const SCROLL_SPY_OFFSET = 136;
const MOBILE_BREAKPOINT = 1280;

export function DocumentReviewSurface({
  documentId,
  title,
  surfaceLabel,
  sourceUrl,
  lifecycleStatus,
  versionLabel,
  syncedAt,
  backHref,
  backLabel,
  plainText,
  projectionVersion,
  children,
}: {
  documentId: number;
  title: string;
  surfaceLabel: string;
  sourceUrl?: string | null;
  lifecycleStatus?: LifecycleStatus | null;
  versionLabel?: string | null;
  syncedAt?: string | null;
  backHref?: string | null;
  backLabel?: string | null;
  plainText: string | null;
  projectionVersion: string | null;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingPositionsRef = useRef<HeadingPosition[]>([]);
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<number | null>(null);
  const [mobileThreadId, setMobileThreadId] = useState<number | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [anchorPositions, setAnchorPositions] = useState<Record<number, number>>({});
  const [documentHeight, setDocumentHeight] = useState(320);
  const [composer, setComposer] = useState<ComposerState>({ open: false });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forkingCommentIds, setForkingCommentIds] = useState<ReadonlySet<number>>(() => new Set());
  const submittingRef = useRef(false);
  const forkGuardRef = useRef<CommentForkGuard | null>(null);
  const loadedPageRef = useRef(1);
  if (forkGuardRef.current === null) {
    forkGuardRef.current = createCommentForkGuard(newCommentDraftIdempotencyKey);
  }
  const numericProjectionVersion = projectionVersion == null ? NaN : Number(projectionVersion);
  const canCapture = plainText != null && Number.isFinite(numericProjectionVersion);
  const openThreadCount = threads.filter((thread) => thread.status === 'open').length;
  const highlightedThreadId = hoveredThreadId ?? activeThreadId;
  const selectedMobileThread = useMemo(() => {
    return mobileThreadId === null ? null : threads.find((thread) => thread.id === mobileThreadId) ?? null;
  }, [mobileThreadId, threads]);
  const composerDraftContextKey = useMemo(() => {
    if (!composer.open) return null;

    return commentDraftContextKey({
      documentId,
      target: composer.mode === 'inline' && composer.anchor
        ? { type: 'anchor', anchor: composer.anchor }
        : { type: 'document' },
    });
  }, [composer, documentId]);
  const composerInitialProposedText = composer.open && composer.mode === 'inline' && composer.anchor
    ? composer.anchor.exact
    : '';
  const composerDraft = useCommentDraft(composerDraftContextKey, {
    initialMode: 'comment',
    initialProposedText: composerInitialProposedText,
  });
  const composerCanSuggest = composer.open
    && composer.mode === 'inline'
    && composer.anchor != null
    && composer.failure == null;
  const composerCommentType = composerCanSuggest ? composerDraft.mode : 'comment';

  const reloadThreads = useCallback(async (targetPage = 1) => {
    const firstPage = await listThreads(documentId, 1);
    const last = firstPage.meta?.last_page ?? 1;
    const finalPage = Math.min(Math.max(1, targetPage), last);
    const remainingPages = finalPage > 1
      ? await Promise.all(Array.from({ length: finalPage - 1 }, (_, index) => listThreads(documentId, index + 2)))
      : [];
    const pages = [firstPage, ...remainingPages];

    loadedPageRef.current = finalPage;
    setThreads(pages.flatMap((threadPage) => threadPage.data));
    setPage(finalPage);
    setLastPage(last);
  }, [documentId]);

  const refreshLoadedThreads = useCallback(async () => {
    await reloadThreads(loadedPageRef.current);
  }, [reloadThreads]);

  useEffect(() => {
    void reloadThreads(1);
  }, [reloadThreads]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    decorateAnchorHighlights(root, threads, highlightedThreadId, plainText ?? '');
  }, [threads, highlightedThreadId, plainText]);

  const refreshDocumentLayout = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const { entries, positions } = collectTocFromRenderedHeadings(root);
    headingPositionsRef.current = positions;
    setTocEntries((current) => tocEntriesEqual(current, entries) ? current : entries);
    setActiveHeadingId(activeHeadingIdForScroll(positions, window.scrollY, SCROLL_SPY_OFFSET));
    const nextAnchorPositions = measureAnchorPositions(root, threads);
    setAnchorPositions((current) => anchorPositionsEqual(current, nextAnchorPositions) ? current : nextAnchorPositions);
    setDocumentHeight(Math.ceil(root.getBoundingClientRect().height));
  }, [threads]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshDocumentLayout);
    };

    schedule();
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(schedule);
      observer.observe(root);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedule);
        observer.disconnect();
      };
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [refreshDocumentLayout]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActiveHeadingId(activeHeadingIdForScroll(headingPositionsRef.current, window.scrollY, SCROLL_SPY_OFFSET));
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);

  const openMobileThread = useCallback((threadId: number | null = null) => {
    const targetId = threadId
      ?? activeThreadId
      ?? threads.find((thread) => thread.status === 'open')?.id
      ?? threads[0]?.id
      ?? null;
    setMobileThreadId(targetId);
    if (targetId !== null) setActiveThreadId(targetId);
  }, [activeThreadId, threads]);

  const activateThreadCard = useCallback((threadId: number) => {
    setActiveThreadId(threadId);
    setHoveredThreadId(null);
    window.requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-thread-card-id="${threadId}"]`);
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function over(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setHoveredThreadId(id);
    }

    function out(event: MouseEvent) {
      const current = event.target instanceof Element
        ? event.target.closest('[data-kedge-thread-ids]')
        : null;
      if (!current) return;
      const next = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest('[data-kedge-thread-ids]')
        : null;
      if (current !== next) setHoveredThreadId(null);
    }

    function focusIn(event: FocusEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setActiveThreadId(id);
    }

    function click(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (!id) return;
      event.preventDefault();
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        openMobileThread(id);
      } else {
        activateThreadCard(id);
      }
    }

    function keyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = firstThreadIdFromTarget(event.target);
      if (!id) return;
      event.preventDefault();
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        openMobileThread(id);
      } else {
        activateThreadCard(id);
      }
    }

    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('click', click);
    root.addEventListener('keydown', keyDown);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keyDown);
    };
  }, [activateThreadCard, openMobileThread]);

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
    };

    if (result.ok) {
      setComposer({ ...base, mode: 'inline', anchor: result.selector, failure: null });
    } else {
      console.warn('anchor capture failed', result);
      setComposer({ ...base, mode: 'document', anchor: null, failure: result });
    }
  }

  async function submit() {
    if (!composer.open || submittingRef.current) return;
    const body = composerDraft.body;
    const proposedText = composerDraft.proposedText;
    const validity = commentComposerSubmitState({
      canSuggest: composer.mode === 'inline' && composer.anchor != null && composer.failure == null,
      commentType: composerDraft.mode,
      body,
      proposedText,
      anchorExact: composer.anchor?.exact,
    });
    if (validity.submitDisabled) {
      if (validity.suggestionUnchanged) setMessage('Edit the text to suggest a change.');

      return;
    }
    setMessage(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await postDocumentComposerDraft({
        documentId,
        draft: {
          mode: composer.mode,
          commentType: composerDraft.mode,
          anchor: composer.anchor,
          failedCapture: composer.failure != null,
          body,
          proposedText,
          idempotencyKey: composerDraft.idempotencyKey,
        },
        createThread,
        createSuggestionThread,
      });

      if (result.status === 'failed') {
        setMessage(result.message);
        return;
      }
      if (result.status === 'invalid') return;

      composerDraft.clear();
      setComposer({ open: false });
      window.getSelection()?.removeAllRanges();
      await refreshLoadedThreads();
      setActiveThreadId(result.value.id);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function setThreadStatus(thread: ReviewThread, status: ThreadStatus): Promise<string | null> {
    const outcome = await updateThreadStatus(thread.id, status);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(outcome.thread.id);

    return null;
  }

  async function setSuggestionStatus(comment: ThreadComment, status: SuggestionStatus): Promise<string | null> {
    const outcome = await updateSuggestionStatus(comment.id, status);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function reply(
    thread: ReviewThread,
    input: ReplyToThreadInput,
    idempotencyKey: string,
  ): Promise<string | null> {
    const outcome = await replyToThread(thread.id, input, idempotencyKey);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(thread.id);

    return null;
  }

  async function fork(_thread: ReviewThread, comment: ThreadComment): Promise<string | null> {
    const forkGuard = forkGuardRef.current;
    if (!forkGuard) return null;
    const started = forkGuard.start(comment.id);
    if (!started.started) return null;
    syncForkingCommentIds();

    let posted = false;
    try {
      const outcome = await forkComment(comment.id, started.idempotencyKey);
      if (!outcome.ok) return outcome.message;

      posted = true;
      await refreshLoadedThreads();
      setActiveThreadId(outcome.thread.id);
    } finally {
      forkGuard.finish(comment.id, { posted });
      syncForkingCommentIds();
    }

    return null;
  }

  function syncForkingCommentIds() {
    setForkingCommentIds(forkGuardRef.current?.forkingCommentIds() ?? new Set());
  }

  async function edit(comment: ThreadComment, nextBody: string): Promise<string | null> {
    const outcome = await editComment(comment.id, nextBody);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function remove(comment: ThreadComment): Promise<string | null> {
    const outcome = await deleteComment(comment.id);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  function focusThread(thread: ReviewThread) {
    setActiveThreadId(thread.id);
    setHoveredThreadId(null);
    const root = rootRef.current;
    const target = firstAnchorHighlightForThread(root, thread.id);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function jumpToHeading(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveHeadingId(id);
  }

  return (
    <div>
      <DocumentReviewHeader
        title={title}
        surfaceLabel={surfaceLabel}
        sourceUrl={sourceUrl}
        lifecycleStatus={lifecycleStatus}
        versionLabel={versionLabel}
        syncedAt={syncedAt}
        openThreadCount={openThreadCount}
        backHref={backHref}
        backLabel={backLabel}
      />

      <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 py-8 lg:grid-cols-[16rem_minmax(0,52rem)] xl:grid-cols-[16rem_minmax(0,52rem)_320px] 2xl:grid-cols-[18rem_minmax(0,52rem)_360px]">
        <DocumentReviewSidebar
          tocEntries={tocEntries}
          activeHeadingId={activeHeadingId}
          threads={threads}
          activeThreadId={activeThreadId}
          lifecycleStatus={lifecycleStatus}
          versionLabel={versionLabel}
          onJumpToHeading={jumpToHeading}
          onFocusThread={focusThread}
        />

        <div
          ref={rootRef}
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
          className="min-w-0 max-w-[52rem]"
        >
          {children}
        </div>

        <DocumentThreadRail
          threads={threads}
          page={page}
          lastPage={lastPage}
          activeThreadId={activeThreadId}
          highlightedThreadId={highlightedThreadId}
          anchorPositions={anchorPositions}
          documentHeight={documentHeight}
          onFocusThread={focusThread}
          onActivateThread={(thread) => setActiveThreadId(thread.id)}
          onHoverThread={(thread) => setHoveredThreadId(thread.id)}
          onLeaveThread={() => setHoveredThreadId(null)}
          onLoadMore={() => void reloadThreads(page + 1)}
          onSetThreadStatus={setThreadStatus}
          onReply={reply}
          onForkComment={fork}
          forkingCommentIds={forkingCommentIds}
          onEditComment={edit}
          onDeleteComment={remove}
          onSetSuggestionStatus={setSuggestionStatus}
        />
      </div>

      {threads.length > 0 ? (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 xl:hidden">
          <button
            type="button"
            onClick={() => openMobileThread()}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-xl ring-1 ring-white/10 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {openThreadCount} open {openThreadCount === 1 ? 'thread' : 'threads'}
          </button>
        </div>
      ) : null}

      <MobileThreadSheet
        open={mobileThreadId !== null}
        thread={selectedMobileThread}
        onClose={() => setMobileThreadId(null)}
        onSetThreadStatus={setThreadStatus}
        onReply={reply}
        onForkComment={fork}
        forkingCommentIds={forkingCommentIds}
        onEditComment={edit}
        onDeleteComment={remove}
        onSetSuggestionStatus={setSuggestionStatus}
      />

      <DocumentCommentComposer
        composer={composer}
        commentType={composerCommentType}
        body={composerDraft.body}
        proposedText={composerDraft.proposedText}
        message={message}
        submitting={submitting}
        onBodyChange={(body) => {
          if (!submittingRef.current) composerDraft.setBody(body);
        }}
        onProposedTextChange={(proposedText) => {
          if (!submittingRef.current) composerDraft.setProposedText(proposedText);
        }}
        onCommentTypeChange={(commentType) => {
          if (!composer.open || submittingRef.current) return;
          if (commentType === 'suggestion' && composerDraft.proposedText === '' && composer.mode === 'inline' && composer.anchor) {
            composerDraft.setProposedText(composer.anchor.exact);
          }
          composerDraft.setMode(commentType);
        }}
        onClose={() => {
          if (submittingRef.current) return;
          composerDraft.clear();
          setComposer({ open: false });
          setMessage(null);
        }}
        onOpenPanel={() => {
          if (submittingRef.current) return;
          if (composer.open) setComposer({ ...composer, stage: 'panel' });
        }}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function collectTocFromRenderedHeadings(root: HTMLElement): { entries: TocEntry[]; positions: HeadingPosition[] } {
  const headingElements = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
  const validElements = headingElements.filter((element) => {
    return /^h[1-6]$/i.test(element.tagName) && (element.textContent ?? '').trim() !== '';
  });
  const entries = deriveTocEntriesFromHeadings(validElements.map((element) => ({
    tagName: element.tagName.toLowerCase(),
    text: element.textContent ?? '',
    id: element.id || null,
  })));

  const positions = entries.map((entry, index) => {
    const element = validElements[index];
    element.id = entry.id;
    element.classList.add('scroll-mt-32');

    return {
      id: entry.id,
      top: element.getBoundingClientRect().top + window.scrollY,
    };
  });

  return { entries, positions };
}

function measureAnchorPositions(root: HTMLElement, threads: ReviewThread[]): Record<number, number> {
  const rootRect = root.getBoundingClientRect();
  const positions: Record<number, number> = {};

  for (const thread of threads) {
    if (!thread.anchor) continue;
    const target = firstAnchorHighlightForThread(root, thread.id);
    if (!target) continue;
    const targetRect = target.getBoundingClientRect();
    positions[thread.id] = targetRect.top - rootRect.top + targetRect.height / 2;
  }

  return positions;
}

function tocEntriesEqual(left: TocEntry[], right: TocEntry[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((entry, index) => {
    const other = right[index];
    return entry.id === other.id && entry.title === other.title && entry.level === other.level;
  });
}

function anchorPositionsEqual(left: Record<number, number>, right: Record<number, number>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => left[Number(key)] === right[Number(key)]);
}

function firstThreadIdFromTarget(target: EventTarget | null): number | null {
  const element = target instanceof Element
    ? target.closest<HTMLElement>('[data-kedge-thread-ids]')
    : null;
  const id = threadIdsFromAttribute(element?.dataset.kedgeThreadIds)[0];
  return id ? Number(id) : null;
}
