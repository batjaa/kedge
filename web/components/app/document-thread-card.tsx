'use client';

import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { StatusBadge } from './document-thread-badges';
import { CommentRow, useCommentEditState } from './document-thread-comment-row';
import { ReplyComposer } from './document-thread-reply-composer';
import { IconButton } from './document-thread-ui';
import { cn } from '@/lib/cn';
import { threadControlsFor } from '@/lib/review-surface-layout';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread, SuggestionStatus, ThreadAnchor, ThreadComment, ThreadStatus } from '@/lib/thread-types';

export function ThreadCard({
  thread,
  active,
  expanded,
  className,
  onFocusThread,
  onActivateThread,
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
  onActivateThread: (thread: ReviewThread) => void;
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
      tabIndex={-1}
      onMouseEnter={() => onHoverThread(thread)}
      onMouseLeave={onLeaveThread}
      onFocusCapture={() => onActivateThread(thread)}
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
