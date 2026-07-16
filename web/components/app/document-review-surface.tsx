'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { DocumentCommentComposer, type ComposerState } from './document-comment-composer';
import { DocumentReviewHeader } from './document-review-header';
import { DocumentReviewSidebar } from './document-review-sidebar';
import { DocumentThreadRail } from './document-thread-rail';
import { MobileThreadSheet } from './mobile-thread-sheet';
import { captureAnchorFromSelection } from '@/lib/anchor-capture-dom';
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
  const [mobileThreadId, setMobileThreadId] = useState<number | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [anchorPositions, setAnchorPositions] = useState<Record<number, number>>({});
  const [documentHeight, setDocumentHeight] = useState(320);
  const [composer, setComposer] = useState<ComposerState>({ open: false });
  const [body, setBody] = useState('');
  const [proposedText, setProposedText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const numericProjectionVersion = projectionVersion == null ? NaN : Number(projectionVersion);
  const canCapture = plainText != null && Number.isFinite(numericProjectionVersion);
  const openThreadCount = threads.filter((thread) => thread.status === 'open').length;
  const selectedMobileThread = useMemo(() => {
    return mobileThreadId === null ? null : threads.find((thread) => thread.id === mobileThreadId) ?? null;
  }, [mobileThreadId, threads]);

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
    decorateAnchorHighlights(root, threads, activeThreadId, plainText ?? '');
  }, [threads, activeThreadId, plainText]);

  const refreshDocumentLayout = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const { entries, positions } = collectTocFromRenderedHeadings(root);
    headingPositionsRef.current = positions;
    setTocEntries(entries);
    setActiveHeadingId(activeHeadingIdForScroll(positions, window.scrollY, SCROLL_SPY_OFFSET));
    setAnchorPositions(measureAnchorPositions(root, threads));
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function over(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setActiveThreadId(id);
    }

    function out(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('[data-kedge-thread-ids]')) {
        setActiveThreadId(null);
      }
    }

    function focusIn(event: FocusEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setActiveThreadId(id);
    }

    function focusOut(event: FocusEvent) {
      if (event.target instanceof Element && event.target.closest('[data-kedge-thread-ids]')) {
        setActiveThreadId(null);
      }
    }

    function click(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (!id || window.innerWidth >= MOBILE_BREAKPOINT) return;
      event.preventDefault();
      openMobileThread(id);
    }

    function keyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = firstThreadIdFromTarget(event.target);
      if (!id || window.innerWidth >= MOBILE_BREAKPOINT) return;
      event.preventDefault();
      openMobileThread(id);
    }

    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    root.addEventListener('click', click);
    root.addEventListener('keydown', keyDown);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keyDown);
    };
  }, [openMobileThread]);

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
      setProposedText(result.selector.exact);
      setComposer({ ...base, mode: 'inline', commentType: 'comment', anchor: result.selector, failure: null });
    } else {
      console.warn('anchor capture failed', result);
      setProposedText('');
      setComposer({ ...base, mode: 'document', commentType: 'comment', anchor: null, failure: result });
    }
  }

  async function submit() {
    if (!composer.open) return;
    const isSuggestion = composer.mode === 'inline' && composer.anchor != null && composer.commentType === 'suggestion';
    const suggestionUnchanged = isSuggestion && proposedText.trim() === composer.anchor?.exact.trim();
    if (isSuggestion ? proposedText.trim() === '' || suggestionUnchanged : body.trim() === '') {
      if (suggestionUnchanged) setMessage('Edit the text to suggest a change.');

      return;
    }
    setMessage(null);

    const anchor = composer.mode === 'inline' && composer.anchor
      ? {
          ...composer.anchor,
          projection_version: String(composer.anchor.projection_version),
        }
      : null;

    const outcome = isSuggestion && anchor
      ? await createSuggestionThread(documentId, {
          body: body.trim() === '' ? undefined : body,
          proposed_text: proposedText,
          anchor,
          idempotency_key: composer.idempotencyKey,
        })
      : composer.mode === 'inline' && anchor
        ? await createThread(documentId, {
            type: 'inline',
            body,
            anchor,
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
    setProposedText('');
    setComposer({ open: false });
    window.getSelection()?.removeAllRanges();
    await reloadThreads(1);
    setActiveThreadId(outcome.thread.id);
  }

  async function setThreadStatus(thread: ReviewThread, status: ThreadStatus): Promise<string | null> {
    const outcome = await updateThreadStatus(thread.id, status);
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(outcome.thread.id);

    return null;
  }

  async function setSuggestionStatus(comment: ThreadComment, status: SuggestionStatus): Promise<string | null> {
    const outcome = await updateSuggestionStatus(comment.id, status);
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function reply(thread: ReviewThread, input: ReplyToThreadInput): Promise<string | null> {
    const outcome = await replyToThread(thread.id, input, newIdempotencyKey());
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(thread.id);

    return null;
  }

  async function fork(_thread: ReviewThread, comment: ThreadComment): Promise<string | null> {
    const outcome = await forkComment(comment.id, newIdempotencyKey());
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(outcome.thread.id);

    return null;
  }

  async function edit(comment: ThreadComment, nextBody: string): Promise<string | null> {
    const outcome = await editComment(comment.id, nextBody);
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function remove(comment: ThreadComment): Promise<string | null> {
    const outcome = await deleteComment(comment.id);
    if (!outcome.ok) return outcome.message;

    await reloadThreads(1);
    setActiveThreadId(comment.thread_id);

    return null;
  }

  function focusThread(thread: ReviewThread) {
    setActiveThreadId(thread.id);
    const root = rootRef.current;
    const target = firstAnchorHighlightForThread(root, thread.id);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => setActiveThreadId(null), 1800);
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

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 py-8 lg:grid-cols-[16rem_minmax(0,52rem)] xl:grid-cols-[16rem_minmax(0,52rem)_320px] 2xl:grid-cols-[18rem_minmax(0,52rem)_360px]">
        <DocumentReviewSidebar
          tocEntries={tocEntries}
          activeHeadingId={activeHeadingId}
          threads={threads}
          activeThreadId={activeThreadId}
          sourceUrl={sourceUrl}
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
          anchorPositions={anchorPositions}
          documentHeight={documentHeight}
          onFocusThread={focusThread}
          onHoverThread={(thread) => setActiveThreadId(thread.id)}
          onLeaveThread={() => setActiveThreadId(null)}
          onLoadMore={() => void reloadThreads(page + 1)}
          onSetThreadStatus={setThreadStatus}
          onReply={reply}
          onForkComment={fork}
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
        onEditComment={edit}
        onDeleteComment={remove}
        onSetSuggestionStatus={setSuggestionStatus}
      />

      <DocumentCommentComposer
        composer={composer}
        body={body}
        proposedText={proposedText}
        message={message}
        onBodyChange={setBody}
        onProposedTextChange={setProposedText}
        onCommentTypeChange={(commentType) => {
          if (!composer.open) return;
          if (commentType === 'suggestion' && proposedText === '' && composer.anchor) {
            setProposedText(composer.anchor.exact);
          }
          setComposer({ ...composer, commentType });
        }}
        onClose={() => {
          setComposer({ open: false });
          setProposedText('');
        }}
        onOpenPanel={() => {
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

function firstThreadIdFromTarget(target: EventTarget | null): number | null {
  const element = target instanceof Element
    ? target.closest<HTMLElement>('[data-kedge-thread-ids]')
    : null;
  const id = threadIdsFromAttribute(element?.dataset.kedgeThreadIds)[0];
  return id ? Number(id) : null;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
