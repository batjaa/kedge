'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { Check, GitFork, MessageSquare, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { commentControlsFor, threadControlsFor } from '@/lib/review-surface-layout';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import { diffSuggestionText, SuggestionDiff } from '@/lib/suggestion-diff';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread, SuggestionStatus, ThreadAnchor, ThreadComment, ThreadStatus } from '@/lib/thread-types';

export function ThreadCard({
  thread,
  active,
  expanded,
  className,
  onFocusThread,
  onHoverThread,
  onLeaveThread,
  onSetThreadStatus,
  onReply,
  onForkComment,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
}: {
  thread: ReviewThread;
  active: boolean;
  expanded: boolean;
  className?: string;
  onFocusThread: (thread: ReviewThread) => void;
  onHoverThread: (thread: ReviewThread) => void;
  onLeaveThread: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
}) {
  const comments = thread.comments && thread.comments.length > 0
    ? thread.comments
    : thread.first_comment
      ? [thread.first_comment]
      : [];
  const visibleComments = expanded ? comments : comments.slice(0, 1);
  const firstComment = comments[0] ?? thread.first_comment;
  const firstCommentId = firstComment?.id ?? null;
  const isSuggestionThread = firstComment?.type === 'suggestion';
  const isAgentThread = comments.some((comment) => comment.client === 'mcp');
  const controls = threadControlsFor(thread);
  const [message, setMessage] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const edit = useCommentEditState(onEditComment, setMessage);
  const [forkingId, setForkingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [suggestionBusyId, setSuggestionBusyId] = useState<number | null>(null);

  async function changeStatus(status: ThreadStatus) {
    setMessage(null);
    setStatusBusy(true);
    const error = await onSetThreadStatus(thread, status);
    setStatusBusy(false);
    if (error) setMessage(error);
  }

  async function fork(comment: ThreadComment) {
    setMessage(null);
    setForkingId(comment.id);
    const error = await onForkComment(thread, comment);
    setForkingId(null);
    if (error) setMessage(error);
  }

  async function remove(comment: ThreadComment) {
    setMessage(null);
    setDeletingId(comment.id);
    const error = await onDeleteComment(comment);
    setDeletingId(null);
    if (error) setMessage(error);
  }

  async function setSuggestionStatus(comment: ThreadComment, status: SuggestionStatus) {
    setMessage(null);
    setSuggestionBusyId(comment.id);
    const error = await onSetSuggestionStatus(comment, status);
    setSuggestionBusyId(null);
    if (error) setMessage(error);
  }

  return (
    <article
      id={`thread-card-${thread.id}`}
      onMouseEnter={() => onHoverThread(thread)}
      onMouseLeave={onLeaveThread}
      onFocusCapture={() => onHoverThread(thread)}
      onBlurCapture={onLeaveThread}
      className={cn(
        'overflow-hidden rounded-2xl bg-white ring-1 ring-inset transition dark:bg-white/[.03]',
        isAgentThread
          ? 'ring-violet-500/20'
          : active
            ? 'ring-emerald-500/60'
            : 'ring-zinc-900/10 dark:ring-white/10',
        thread.status === 'resolved' && !active ? 'opacity-75' : null,
        className,
      )}
      data-thread-card-id={thread.id}
    >
      <div className="flex items-center gap-2 border-b border-zinc-900/5 px-4 py-2.5 dark:border-white/5">
        <button
          type="button"
          onClick={() => onFocusThread(thread)}
          className="min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <span className="text-xs font-semibold text-zinc-900 dark:text-white">
            {isAgentThread ? 'Agent' : isSuggestionThread ? 'Suggestion' : 'Thread'}
          </span>
        </button>
        <span className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {sectionLabel(thread.anchor)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <StatusBadge status={thread.status} suggestion={isSuggestionThread} agent={isAgentThread} />
          {controls.resolve ? (
            <IconButton title="Resolve thread" disabled={statusBusy} onClick={() => void changeStatus('resolved')}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {controls.reopen ? (
            <IconButton title="Reopen thread" disabled={statusBusy} onClick={() => void changeStatus('open')}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onFocusThread(thread)}
        className="block w-full px-4 pt-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {thread.forked_from_comment_id ? (
          <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-500">
            Forked from comment #{thread.forked_from_comment_id}
          </p>
        ) : null}
        {thread.anchor ? <Quote anchor={thread.anchor} /> : null}
      </button>

      <div className="px-4 py-3.5">
        <div className="space-y-3">
          {visibleComments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              isReply={firstCommentId !== comment.id}
              editing={edit.isEditing(comment)}
              editBody={edit.body}
              forking={forkingId === comment.id}
              deleting={deletingId === comment.id}
              onStartEdit={() => edit.start(comment)}
              onCancelEdit={edit.cancel}
              onEditBodyChange={edit.setBody}
              onSaveEdit={() => void edit.save(comment)}
              onFork={() => void fork(comment)}
              onDelete={() => void remove(comment)}
              anchorExact={thread.anchor?.exact ?? null}
              suggestionBusy={suggestionBusyId === comment.id}
              onSetSuggestionStatus={(status) => void setSuggestionStatus(comment, status)}
            />
          ))}
        </div>
        {!expanded && comments.length > 1 ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {comments.length - 1} more {comments.length === 2 ? 'reply' : 'replies'}
          </p>
        ) : null}
        {thread.forked_into_count > 0 ? (
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-500">
            Forked into {thread.forked_into_count} {thread.forked_into_count === 1 ? 'thread' : 'threads'}
          </p>
        ) : null}
        {expanded ? (
          <ReplyComposer
            thread={thread}
            onReply={onReply}
            onMessage={setMessage}
          />
        ) : null}
        {message ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
      </div>
    </article>
  );
}

function ReplyComposer({
  thread,
  onReply,
  onMessage,
}: {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput) => Promise<string | null>;
  onMessage: (message: string | null) => void;
}) {
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyType, setReplyType] = useState<'comment' | 'suggestion'>('comment');
  const [proposedText, setProposedText] = useState(thread.anchor?.exact ?? '');
  const canSuggest = thread.type === 'inline' && thread.anchor !== null;
  const isSuggestion = canSuggest && replyType === 'suggestion';
  const suggestionUnchanged = isSuggestion && proposedText.trim() === thread.anchor?.exact.trim();
  const submitDisabled = replying
    || (isSuggestion ? proposedText.trim() === '' || suggestionUnchanged : replyBody.trim() === '');

  async function submitReply() {
    if (submitDisabled) return;
    onMessage(null);
    setReplying(true);
    const error = isSuggestion
      ? await onReply(thread, {
          comment_type: 'suggestion',
          body: replyBody.trim() === '' ? undefined : replyBody.trim(),
          proposed_text: proposedText,
        })
      : await onReply(thread, { body: replyBody.trim() });
    setReplying(false);
    if (error) {
      onMessage(error);
      return;
    }
    setReplyBody('');
    setProposedText(thread.anchor?.exact ?? '');
    setReplyType('comment');
  }

  return (
    <div className="mt-4 border-t border-zinc-900/5 pt-3 dark:border-white/5">
      {thread.status === 'resolved' ? (
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">resolved — reopen?</p>
      ) : null}
      {canSuggest ? (
        <div className="mb-2 grid w-full grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
          <ModeButton active={!isSuggestion} onClick={() => setReplyType('comment')}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Comment
          </ModeButton>
          <ModeButton
            active={isSuggestion}
            onClick={() => {
              setReplyType('suggestion');
              if (proposedText === '') setProposedText(thread.anchor?.exact ?? '');
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Suggest
          </ModeButton>
        </div>
      ) : null}
      {isSuggestion ? (
        <div className="space-y-2">
          <textarea
            value={proposedText}
            onChange={(event) => setProposedText(event.target.value)}
            rows={3}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Replacement text"
          />
          {suggestionUnchanged ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Edit the text to suggest a change.</p>
          ) : null}
          <textarea
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            rows={2}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Add a note"
          />
        </div>
      ) : (
        <textarea
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
          rows={2}
          className={TEXTAREA_CLASS_NAME}
          placeholder="Reply"
        />
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void submitReply()}
          disabled={submitDisabled}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {isSuggestion ? 'Suggest' : 'Reply'}
        </button>
      </div>
    </div>
  );
}

function useCommentEditState(
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

function CommentRow({
  comment,
  isReply,
  editing,
  editBody,
  forking,
  deleting,
  anchorExact,
  suggestionBusy,
  onStartEdit,
  onCancelEdit,
  onEditBodyChange,
  onSaveEdit,
  onFork,
  onDelete,
  onSetSuggestionStatus,
}: {
  comment: ThreadComment;
  isReply: boolean;
  editing: boolean;
  editBody: string;
  forking: boolean;
  deleting: boolean;
  anchorExact: string | null;
  suggestionBusy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditBodyChange: (body: string) => void;
  onSaveEdit: () => void;
  onFork: () => void;
  onDelete: () => void;
  onSetSuggestionStatus: (status: SuggestionStatus) => void;
}) {
  const author = comment.author?.name ?? 'Reviewer';
  const controls = commentControlsFor(comment, isReply);
  const body = useMemo(
    () => comment.is_deleted ? null : renderCommentMarkdown(comment.body_md ?? ''),
    [comment.body_md, comment.is_deleted],
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
          {comment.edited_at && !comment.is_deleted ? <span className="text-[10px] text-zinc-400">edited</span> : null}
          {isSuggestion && comment.suggestion_status ? <SuggestionStatusBadge status={comment.suggestion_status} /> : null}
          <span className="ml-auto text-[10px] text-zinc-400">{relativeTime(comment.created_at)}</span>
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea
              value={editBody}
              onChange={(event) => onEditBodyChange(event.target.value)}
              rows={3}
              className={TEXTAREA_CLASS_NAME}
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <IconButton title="Cancel edit" onClick={onCancelEdit}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
              <IconButton title="Save edit" disabled={editBody.trim() === ''} onClick={onSaveEdit}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        ) : comment.is_deleted ? (
          <p className="mt-1 text-sm italic leading-6 text-zinc-500 dark:text-zinc-500">comment deleted</p>
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
          {controls.edit ? (
            <IconButton title="Edit comment" onClick={onStartEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {controls.delete ? (
            <IconButton title="Delete comment" disabled={deleting} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {controls.fork ? (
            <IconButton title="Fork into new thread" disabled={forking} onClick={onFork}>
              <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
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
  return (
    <>
      {controls.acceptSuggestion ? (
        <IconButton title="Accept suggestion" disabled={busy} onClick={() => onSetStatus('accepted')}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {controls.declineSuggestion ? (
        <IconButton title="Decline suggestion" disabled={busy} onClick={() => onSetStatus('declined')}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {controls.reopenSuggestion ? (
        <IconButton title="Reopen suggestion" disabled={busy} onClick={() => onSetStatus('pending')}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
    </>
  );
}

function IconButton({
  title,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        active
          ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:text-white dark:ring-white/10'
          : 'text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status, suggestion, agent }: { status: ThreadStatus; suggestion: boolean; agent: boolean }) {
  const classes = agent
    ? 'ring-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-400'
    : suggestion
      ? 'ring-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400'
      : status === 'resolved'
        ? 'ring-zinc-400/30 text-zinc-500 dark:text-zinc-400'
        : 'ring-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400';

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {agent ? 'agent' : suggestion ? 'sugg' : status}
    </span>
  );
}

function SuggestionStatusBadge({ status }: { status: SuggestionStatus }) {
  const classes = {
    pending: 'ring-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400',
    accepted: 'ring-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400',
    declined: 'ring-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-400',
  }[status];

  return (
    <span className={cn('rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset', classes)}>
      {status}
    </span>
  );
}

function AgentBadge() {
  return (
    <span className="rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ring-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-400">
      mcp
    </span>
  );
}

function Quote({ anchor }: { anchor: ThreadAnchor }) {
  return (
    <span className="block border-l-2 border-emerald-500/40 pl-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
      {anchor.exact}
    </span>
  );
}

function sectionLabel(anchor: ThreadAnchor | null): string {
  if (!anchor) return 'document';
  const section = anchor.heading_path.at(-1);
  return section ? `§ ${section}` : '§ selection';
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

function relativeTime(value: string | null): string {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const TEXTAREA_CLASS_NAME = 'block w-full resize-none rounded-lg border-0 bg-zinc-50 p-2 text-xs leading-5 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-white/[.03] dark:text-white dark:ring-zinc-700';
