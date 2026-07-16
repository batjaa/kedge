'use client';

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ThreadCard } from './document-thread-card';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread, SuggestionStatus, ThreadComment, ThreadStatus } from '@/lib/thread-types';

export function MobileThreadSheet({
  open,
  thread,
  onClose,
  onSetThreadStatus,
  onReply,
  onForkComment,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
}: {
  open: boolean;
  thread: ReviewThread | null;
  onClose: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.setTimeout(() => {
      firstFocusable(panelRef.current)?.focus();
    }, 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button
        type="button"
        aria-label="Close thread sheet"
        className="absolute inset-0 cursor-default bg-zinc-900/45"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Thread"
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Thread</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        {thread ? (
          <ThreadCard
            thread={thread}
            active
            expanded
            onFocusThread={() => {}}
            onHoverThread={() => {}}
            onLeaveThread={() => {}}
            onSetThreadStatus={onSetThreadStatus}
            onReply={onReply}
            onForkComment={onForkComment}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            onSetSuggestionStatus={onSetSuggestionStatus}
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No threads yet.
          </p>
        )}
      </div>
    </div>
  );
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusables = focusableElements(event.currentTarget);
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return root ? focusableElements(root)[0] ?? root : null;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}
