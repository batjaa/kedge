'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { DocumentCommentComposer, type ComposerState } from './document-comment-composer';
import { DocumentThreadRail } from './document-thread-rail';
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
} from '@/lib/comments-client';
import {
  decorateAnchorHighlights,
  firstAnchorHighlightForThread,
  threadIdsFromAttribute,
} from '@/lib/anchor-highlight-dom';
import type { ReviewThread, SuggestionStatus, ThreadComment, ThreadStatus } from '@/lib/thread-types';

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
  const [proposedText, setProposedText] = useState('');
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
    decorateAnchorHighlights(root, threads, activeThreadId, plainText ?? '');
  }, [threads, activeThreadId, plainText]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function over(event: MouseEvent) {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-kedge-thread-ids]')
        : null;
      const id = threadIdsFromAttribute(target?.dataset.kedgeThreadIds)[0];
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

  async function reply(thread: ReviewThread, replyBody: string): Promise<string | null> {
    const outcome = await replyToThread(thread.id, replyBody, newIdempotencyKey());
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

      <DocumentThreadRail
        threads={threads}
        page={page}
        lastPage={lastPage}
        activeThreadId={activeThreadId}
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

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
