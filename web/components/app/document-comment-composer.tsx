'use client';

import { MessageSquare, Send } from 'lucide-react';
import type { AnchorCaptureFailure, AnchorSelector } from '@/lib/anchor-capture-core';

export type ComposerState =
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

export function DocumentCommentComposer({
  composer,
  body,
  message,
  onBodyChange,
  onClose,
  onOpenPanel,
  onSubmit,
}: {
  composer: ComposerState;
  body: string;
  message: string | null;
  onBodyChange: (body: string) => void;
  onClose: () => void;
  onOpenPanel: () => void;
  onSubmit: () => void;
}) {
  if (!composer.open) return null;

  if (composer.stage === 'affordance') {
    return (
      <button
        type="button"
        onClick={onOpenPanel}
        className="fixed z-50 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/10 hover:bg-zinc-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        style={{ left: composer.x, top: composer.y, transform: 'translateX(-50%)' }}
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Comment
      </button>
    );
  }

  return (
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
        onChange={(event) => onBodyChange(event.target.value)}
        rows={4}
        className="block w-full resize-none rounded-lg border-0 bg-zinc-50 p-3 text-sm leading-6 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700"
        placeholder="Write a comment"
      />
      {message ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={body.trim() === ''}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Post
        </button>
      </div>
    </div>
  );
}
