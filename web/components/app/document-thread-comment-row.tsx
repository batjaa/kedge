'use client';

import { useMemo, useState } from 'react';
import { Check, GitFork, Pencil, RotateCcw, ThumbsUp, Trash2, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { AiSplitAction, type SplitCapability } from './ai-split-action';
import { AgentBadge, SuggestionStatusBadge } from './document-thread-badges';
import { IconButton, TEXTAREA_CLASS_NAME } from './document-thread-ui';
import { cn } from '@/lib/cn';
import { commentControlsFor } from '@/lib/review-surface-layout';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import { diffSuggestionText, SuggestionDiff } from '@/lib/suggestion-diff';
import { formatRelativeTime } from '@/lib/intl-time';
import type { SuggestionStatus, ThreadComment } from '@/lib/thread-types';

export function useCommentEditState(
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>,
  setMessage: (message: string | null) => void,
) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [body, setBody] = useState('');

  return {
    body,
    setBody,
    isEditing: (comment: ThreadComment) => editingId === comment.id,
    start: (comment: ThreadComment) => {
      setEditingId(comment.id);
      setBody(comment.body_md ?? '');
    },
    cancel: () => {
      setEditingId(null);
      setBody('');
    },
    save: async (comment: ThreadComment) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      setMessage(null);
      const error = await onEditComment(comment, trimmed);
      if (error) {
        setMessage(error);
        return;
      }
      setEditingId(null);
      setBody('');
    },
  };
}

export function CommentRow({
  comment,
  isReply,
  editing,
  editBody,
  forking,
  deleting,
  anchorExact,
  suggestionBusy,
  reactionBusy,
  onStartEdit,
  onCancelEdit,
  onEditBodyChange,
  onSaveEdit,
  onFork,
  onDelete,
  onSetSuggestionStatus,
  onToggleReaction,
  splitCapability,
}: {
  comment: ThreadComment;
  isReply: boolean;
  editing: boolean;
  editBody: string;
  forking: boolean;
  deleting: boolean;
  anchorExact: string | null;
  suggestionBusy: boolean;
  reactionBusy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditBodyChange: (body: string) => void;
  onSaveEdit: () => void;
  onFork: () => void;
  onDelete: () => void;
  onSetSuggestionStatus: (status: SuggestionStatus) => void;
  onToggleReaction: () => void;
  /** Absent when the instance has no Anthropic key: no split affordance exists. */
  splitCapability?: SplitCapability;
}) {
  const t = useTranslations('threads');
  const locale = useLocale();
  const author = comment.author?.name ?? t('comment.reviewerFallback');
  const controls = commentControlsFor(comment, isReply);
  const body = useMemo(
    () => comment.is_deleted ? null : renderCommentMarkdown(comment.body_md ?? '', comment.mentions),
    [comment.body_md, comment.is_deleted, comment.mentions],
  );
  const hasBody = !comment.is_deleted && (comment.body_md ?? '').trim() !== '';
  const isSuggestion = comment.type === 'suggestion' && !comment.is_deleted;
  const proposedText = comment.proposed_text ?? '';
  const suggestionDiff = useMemo(
    () => isSuggestion ? diffSuggestionText(anchorExact ?? '', proposedText) : null,
    [anchorExact, proposedText, comment.is_deleted, comment.type, isSuggestion],
  );

  return (
    <div className={cn('flex items-start gap-2', isReply ? 'border-l-2 border-zinc-100 pl-3 dark:border-white/10' : null)}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-medium text-white dark:bg-zinc-700">
        {initials(author)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{author}</span>
          {comment.client === 'mcp' ? <AgentBadge /> : null}
          {comment.edited_at && !comment.is_deleted ? <span className="text-[10px] text-zinc-400">{t('comment.edited')}</span> : null}
          {isSuggestion && comment.suggestion_status ? <SuggestionStatusBadge status={comment.suggestion_status} /> : null}
          <span className="ml-auto text-[10px] text-zinc-400">{formatRelativeTime(comment.created_at, locale)}</span>
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea
              value={editBody}
              onChange={(event) => onEditBodyChange(event.target.value)}
              rows={3}
              className={TEXTAREA_CLASS_NAME}
              aria-label={t('comment.editBodyLabel')}
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <IconButton title={t('comment.cancelEdit')} onClick={onCancelEdit}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
              <IconButton title={t('comment.saveEdit')} disabled={editBody.trim() === ''} onClick={onSaveEdit}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        ) : comment.is_deleted ? (
          <p className="mt-1 text-sm italic leading-6 text-zinc-500 dark:text-zinc-500">{t('comment.deleted')}</p>
        ) : (
          <>
            {suggestionDiff ? <SuggestionDiff diff={suggestionDiff} /> : null}
            {hasBody ? (
              <div className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{body}</div>
            ) : null}
          </>
        )}
      </div>
      {!editing ? (
        <div className="flex shrink-0 items-center gap-1">
          {isSuggestion ? (
            <SuggestionActions
              controls={controls}
              busy={suggestionBusy}
              onSetStatus={onSetSuggestionStatus}
            />
          ) : null}
          {comment.can_react ? (
            <ReactionButton
              count={comment.reaction_count}
              active={comment.viewer_has_reacted}
              busy={reactionBusy}
              onToggle={onToggleReaction}
            />
          ) : null}
          {controls.edit ? (
            <IconButton title={t('comment.edit')} onClick={onStartEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {controls.delete ? (
            <IconButton title={t('comment.delete')} disabled={deleting} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {controls.fork ? (
            <IconButton title={t('comment.fork')} disabled={forking} onClick={onFork}>
              <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {/* The AI split affordance sits next to fork because it IS a fork:
              approving a proposal posts the same endpoint with the proposal's
              anchor. Shown only where a fork could actually land — and absent
              entirely on an instance with no Anthropic key. */}
          {controls.fork && splitCapability ? (
            <AiSplitAction commentId={comment.id} capability={splitCapability} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReactionButton({
  count,
  active,
  busy,
  onToggle,
}: {
  count: number;
  active: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('threads');
  const format = useFormatter();

  return (
    <button
      type="button"
      title={active ? t('comment.removeReaction') : t('comment.react')}
      aria-label={active ? t('comment.removeReaction') : t('comment.react')}
      aria-pressed={active}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-400/30 dark:text-emerald-300'
          : 'text-zinc-500 ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white',
      )}
    >
      <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{format.number(count)}</span>
    </button>
  );
}

function SuggestionActions({
  controls,
  busy,
  onSetStatus,
}: {
  controls: ReturnType<typeof commentControlsFor>;
  busy: boolean;
  onSetStatus: (status: SuggestionStatus) => void;
}) {
  const t = useTranslations('threads');

  return (
    <>
      {controls.acceptSuggestion ? (
        <IconButton title={t('comment.acceptSuggestion')} disabled={busy} onClick={() => onSetStatus('accepted')}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {controls.declineSuggestion ? (
        <IconButton title={t('comment.declineSuggestion')} disabled={busy} onClick={() => onSetStatus('declined')}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {controls.reopenSuggestion ? (
        <IconButton title={t('comment.reopenSuggestion')} disabled={busy} onClick={() => onSetStatus('pending')}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
    </>
  );
}

function initials(name: string): string {
  const value = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return value || '?';
}
