'use client';

import { type ReactNode } from 'react';
import { MessageSquare, Pencil, Send } from 'lucide-react';
import { MentionTextarea } from './mention-textarea';
import type { AnchorCaptureFailure, AnchorSelector } from '@/lib/anchor-capture-core';
import { commentComposerSubmitState } from '@/lib/comment-composer';
import type { CommentType } from '@/lib/thread-types';

const TEXTAREA_CLASS_NAME = 'block w-full resize-none rounded-lg border-0 bg-zinc-50 p-3 text-sm leading-6 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700';

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
    };

export function DocumentCommentComposer({
  documentId,
  composer,
  commentType,
  body,
  proposedText,
  message,
  submitting,
  onBodyChange,
  onProposedTextChange,
  onCommentTypeChange,
  onClose,
  onOpenPanel,
  onSubmit,
}: {
  documentId: number;
  composer: ComposerState;
  commentType: CommentType;
  body: string;
  proposedText: string;
  message: string | null;
  submitting: boolean;
  onBodyChange: (body: string) => void;
  onProposedTextChange: (proposedText: string) => void;
  onCommentTypeChange: (type: CommentType) => void;
  onClose: () => void;
  onOpenPanel: () => void;
  onSubmit: () => void;
}) {
  if (!composer.open) return null;
  const canSuggest = composer.mode === 'inline' && composer.anchor != null && composer.failure == null;
  const submitState = commentComposerSubmitState({
    canSuggest,
    commentType,
    body,
    proposedText,
    anchorExact: composer.anchor?.exact,
    submitting,
  });
  const { isSuggestion, suggestionUnchanged, submitDisabled } = submitState;

  if (composer.stage === 'affordance') {
    return (
      <button
        type="button"
        onClick={onOpenPanel}
        className="fixed z-50 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/10 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        style={{ left: composer.x, top: composer.y, transform: 'translateX(-50%)' }}
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Comment
      </button>
    );
  }

  return (
    <div
      className="fixed z-50 max-h-[calc(100vh-2rem)] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-white p-3 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
      style={{
        left: composer.x,
        top: `clamp(1rem, ${composer.y}px, calc(100vh - 30rem))`,
        transform: 'translateX(-50%)',
      }}
    >
      {composer.failure ? (
        <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          Selection could not be anchored. Comment on the whole document instead.
        </div>
      ) : null}
      {canSuggest ? (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
          <ModeButton active={!isSuggestion} disabled={submitting} onClick={() => onCommentTypeChange('comment')}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Comment
          </ModeButton>
          <ModeButton active={isSuggestion} disabled={submitting} onClick={() => onCommentTypeChange('suggestion')}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Suggest
          </ModeButton>
        </div>
      ) : null}
      {isSuggestion ? (
        <div className="space-y-2">
          <textarea
            value={proposedText}
            onChange={(event) => {
              if (!submitting) onProposedTextChange(event.target.value);
            }}
            rows={4}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Replacement text"
            aria-label="Suggested replacement"
            disabled={submitting}
          />
          {suggestionUnchanged ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Edit the text to suggest a change.</p>
          ) : null}
          <MentionTextarea
            documentId={documentId}
            value={body}
            onChange={(nextBody) => {
              if (!submitting) onBodyChange(nextBody);
            }}
            rows={2}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Add a note"
            ariaLabel="Suggestion note"
            disabled={submitting}
          />
        </div>
      ) : (
        <MentionTextarea
          documentId={documentId}
          value={body}
          onChange={(nextBody) => {
            if (!submitting) onBodyChange(nextBody);
          }}
          rows={4}
          className={TEXTAREA_CLASS_NAME}
          placeholder="Write a comment"
          ariaLabel="Inline comment"
          disabled={submitting}
        />
      )}
      {message ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          aria-busy={submitting}
          aria-label={isSuggestion ? 'Submit suggestion' : 'Post comment'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {isSuggestion ? 'Suggest' : 'Post'}
        </button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:text-white dark:ring-white/10'
          : 'text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-white/5',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
