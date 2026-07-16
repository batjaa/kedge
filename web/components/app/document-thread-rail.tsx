'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { Check, GitFork, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { renderCommentMarkdown } from '@/lib/render-comment-markdown';
import { SuggestionDiff } from '@/lib/suggestion-diff';
import type { ReviewThread, SuggestionStatus, ThreadAnchor, ThreadComment, ThreadStatus } from '@/lib/thread-types';

export function DocumentThreadRail({
  threads,
  page,
  lastPage,
  activeThreadId,
  onFocusThread,
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
  onFocusThread: (thread: ReviewThread) => void;
  onHoverThread: (thread: ReviewThread) => void;
  onLeaveThread: () => void;
  onLoadMore: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onReply: (thread: ReviewThread, body: string) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
}) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto" data-review-rail>
      <div className="flex items-center justify-between border-b border-zinc-900/10 pb-2 dark:border-white/10">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Threads</h2>
        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{threads.length}</span>
      </div>
      {threads.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          active={activeThreadId === thread.id}
          onFocus={() => onFocusThread(thread)}
          onHover={() => onHoverThread(thread)}
          onLeave={onLeaveThread}
          onSetThreadStatus={onSetThreadStatus}
          onReply={onReply}
          onForkComment={onForkComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onSetSuggestionStatus={onSetSuggestionStatus}
        />
      ))}
      {threads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No threads yet.
        </p>
      ) : null}
      {page < lastPage ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-white/5"
        >
          Load more
        </button>
      ) : null}
    </aside>
  );
}

function ThreadCard({
  thread,
  active,
  onFocus,
  onHover,
  onLeave,
  onSetThreadStatus,
  onReply,
  onForkComment,
  onEditComment,
  onDeleteComment,
  onSetSuggestionStatus,
}: {
  thread: ReviewThread;
  active: boolean;
  onFocus: () => void;
  onHover: () => void;
  onLeave: () => void;
  onSetThreadStatus: (thread: ReviewThread, status: ThreadStatus) => Promise<string | null>;
  onReply: (thread: ReviewThread, body: string) => Promise<string | null>;
  onForkComment: (thread: ReviewThread, comment: ThreadComment) => Promise<string | null>;
  onEditComment: (comment: ThreadComment, body: string) => Promise<string | null>;
  onDeleteComment: (comment: ThreadComment) => Promise<string | null>;
  onSetSuggestionStatus: (comment: ThreadComment, status: SuggestionStatus) => Promise<string | null>;
}) {
  const author = thread.first_comment?.author?.name ?? 'Reviewer';
  const comments = thread.comments && thread.comments.length > 0
    ? thread.comments
    : thread.first_comment
      ? [thread.first_comment]
      : [];
  const firstCommentId = thread.first_comment?.id ?? comments[0]?.id ?? null;
  const [replyBody, setReplyBody] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
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

  async function submitReply() {
    const trimmed = replyBody.trim();
    if (!trimmed || replying) return;
    setMessage(null);
    setReplying(true);
    const error = await onReply(thread, trimmed);
    setReplying(false);
    if (error) {
      setMessage(error);
      return;
    }
    setReplyBody('');
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
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={[
        'rounded-lg p-4 ring-1 transition',
        thread.status === 'resolved' ? 'bg-zinc-50 dark:bg-white/[.02]' : 'bg-white dark:bg-white/[.03]',
        active ? 'ring-emerald-500/60 shadow-sm' : 'ring-zinc-900/10 dark:ring-white/10',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <button type="button" onClick={onFocus} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-900 dark:text-white">{thread.type === 'inline' ? 'Inline' : 'Document'}</span>
            <StatusBadge status={thread.status} />
            <span className="ml-auto text-[10px] text-zinc-400">{relativeTime(thread.latest_activity_at)}</span>
          </div>
          {thread.forked_from_comment_id ? (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">
              Forked from comment #{thread.forked_from_comment_id}
            </p>
          ) : null}
          {thread.forked_into_count > 0 ? (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">
              Forked into {thread.forked_into_count} {thread.forked_into_count === 1 ? 'thread' : 'threads'}
            </p>
          ) : null}
          {thread.anchor ? <Quote anchor={thread.anchor} /> : null}
        </button>
        <div className="flex items-center gap-2">
          {thread.can_resolve ? (
            <IconButton title="Resolve thread" disabled={statusBusy} onClick={() => void changeStatus('resolved')}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          {thread.can_reopen ? (
            <IconButton title="Reopen thread" disabled={statusBusy} onClick={() => void changeStatus('open')}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[9px] font-medium text-white">
          {initials(author)}
        </span>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{author}</span>
        {thread.comment_count > 1 ? <span>{thread.comment_count} comments</span> : null}
      </div>
      <div className="mt-3 divide-y divide-zinc-900/5 dark:divide-white/10">
        {comments.map((comment) => (
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
      <div className="mt-3">
        <textarea
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
          rows={2}
          className="block w-full resize-none rounded-md border-0 bg-white p-2 text-xs leading-5 text-zinc-900 ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-white dark:ring-zinc-700"
          placeholder="Reply"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {thread.status === 'resolved' ? (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">resolved — reopen?</span>
          ) : <span />}
          <button
            type="button"
            onClick={() => void submitReply()}
            disabled={replying || replyBody.trim() === ''}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Reply
          </button>
        </div>
      </div>
      {message ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
    </article>
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
  const body = useMemo(
    () => comment.is_deleted ? null : renderCommentMarkdown(comment.body_md ?? ''),
    [comment.body_md, comment.is_deleted],
  );
  const hasBody = !comment.is_deleted && (comment.body_md ?? '').trim() !== '';
  const isSuggestion = comment.type === 'suggestion' && !comment.is_deleted;

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-medium text-white dark:bg-zinc-700">
          {initials(author)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{author}</span>
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
                className="block w-full resize-none rounded-md border-0 bg-white p-2 text-xs leading-5 text-zinc-900 ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-white dark:ring-zinc-700"
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
              {isSuggestion ? (
                <SuggestionDiff before={anchorExact ?? ''} after={comment.proposed_text ?? ''} />
              ) : null}
              {hasBody ? (
                <div className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{body}</div>
              ) : null}
            </>
          )}
        </div>
        {!editing ? (
          <div className="flex shrink-0 items-center gap-1">
            {isSuggestion && comment.can_resolve_suggestion ? (
              <SuggestionActions
                status={comment.suggestion_status}
                busy={suggestionBusy}
                onSetStatus={onSetSuggestionStatus}
              />
            ) : null}
            {comment.can_edit && !comment.is_deleted ? (
              <IconButton title="Edit comment" onClick={onStartEdit}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            ) : null}
            {comment.can_delete && !comment.is_deleted ? (
              <IconButton title="Delete comment" disabled={deleting} onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            ) : null}
            {isReply && comment.can_fork ? (
              <IconButton title="Fork into new thread" disabled={forking} onClick={onFork}>
                <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function SuggestionActions({
  status,
  busy,
  onSetStatus,
}: {
  status: SuggestionStatus | null;
  busy: boolean;
  onSetStatus: (status: SuggestionStatus) => void;
}) {
  if (status === null) return null;

  return (
    <>
      {status !== 'accepted' ? (
        <IconButton title="Accept suggestion" disabled={busy} onClick={() => onSetStatus('accepted')}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {status !== 'declined' ? (
        <IconButton title="Decline suggestion" disabled={busy} onClick={() => onSetStatus('declined')}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
      {status !== 'pending' ? (
        <IconButton title="Reopen suggestion" disabled={busy} onClick={() => onSetStatus('pending')}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
    </>
  );
}

function StatusBadge({ status }: { status: ThreadStatus }) {
  const classes = status === 'resolved'
    ? 'text-zinc-600 ring-zinc-400/30 dark:text-zinc-300 dark:ring-zinc-500/30'
    : 'text-emerald-700 ring-emerald-500/25 dark:text-emerald-300';

  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase ring-1 ring-inset ${classes}`}>
      {status}
    </span>
  );
}

function SuggestionStatusBadge({ status }: { status: SuggestionStatus }) {
  const classes = {
    pending: 'text-zinc-600 ring-zinc-400/30 dark:text-zinc-300 dark:ring-zinc-500/30',
    accepted: 'text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
    declined: 'text-rose-700 ring-rose-500/25 dark:text-rose-300',
  }[status];

  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase ring-1 ring-inset ${classes}`}>
      {status}
    </span>
  );
}

function Quote({ anchor }: { anchor: ThreadAnchor }) {
  return (
    <blockquote className="mt-3 border-l-2 border-emerald-500/40 pl-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
      {anchor.exact}
    </blockquote>
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

function relativeTime(value: string | null): string {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
