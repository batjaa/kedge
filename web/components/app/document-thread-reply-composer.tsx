'use client';

import { useRef, useState } from 'react';
import { MessageSquare, Pencil, Send } from 'lucide-react';
import { ModeButton, TEXTAREA_CLASS_NAME } from './document-thread-ui';
import { commentDraftContextKey, useCommentDraft, type CommentDraftMode } from '@/lib/comment-draft';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread } from '@/lib/thread-types';

export function ReplyComposer({
  thread,
  onReply,
  onMessage,
}: {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
  onMessage: (message: string | null) => void;
}) {
  const [replying, setReplying] = useState(false);
  const replyingRef = useRef(false);
  const [replyType, setReplyType] = useState<CommentDraftMode>('comment');
  const canSuggest = thread.type === 'inline' && thread.anchor !== null;
  const draftMode = canSuggest ? replyType : 'comment';
  const isSuggestion = draftMode === 'suggestion';
  const draft = useCommentDraft(
    commentDraftContextKey({
      documentId: thread.document_id,
      target: { type: 'thread', threadId: thread.id },
      mode: draftMode,
    }),
    { initialProposedText: isSuggestion ? thread.anchor?.exact ?? '' : '' },
  );
  const replyBody = draft.body;
  const proposedText = draft.proposedText;
  const trimmedProposedText = proposedText.trim();
  const suggestionUnchanged = isSuggestion && trimmedProposedText === thread.anchor?.exact.trim();
  const submitDisabled = replying
    || (isSuggestion ? trimmedProposedText === '' || suggestionUnchanged : replyBody.trim() === '');

  async function submitReply() {
    if (submitDisabled || replyingRef.current) return;
    onMessage(null);
    replyingRef.current = true;
    setReplying(true);
    try {
      const error = isSuggestion
        ? await onReply(thread, {
            comment_type: 'suggestion',
            body: replyBody.trim() === '' ? undefined : replyBody.trim(),
            proposed_text: trimmedProposedText,
          }, draft.idempotencyKey)
        : await onReply(thread, { body: replyBody.trim() }, draft.idempotencyKey);
      if (error) {
        onMessage(error);
        return;
      }
      draft.clear();
      setReplyType('comment');
    } finally {
      replyingRef.current = false;
      setReplying(false);
    }
  }

  function cancelDraft() {
    if (replying) return;
    draft.clear();
    onMessage(null);
  }

  return (
    <div className="mt-4 border-t border-zinc-900/5 pt-3 dark:border-white/5">
      {thread.status === 'resolved' ? (
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">resolved - reopen?</p>
      ) : null}
      {canSuggest ? (
        <div className="mb-2 grid w-full grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
          <ModeButton active={!isSuggestion} onClick={() => setReplyType('comment')}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Comment
          </ModeButton>
          <ModeButton
            active={isSuggestion}
            onClick={() => setReplyType('suggestion')}
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
            onChange={(event) => draft.setProposedText(event.target.value)}
            rows={3}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Replacement text"
          />
          {suggestionUnchanged ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Edit the text to suggest a change.</p>
          ) : null}
          <textarea
            value={replyBody}
            onChange={(event) => draft.setBody(event.target.value)}
            rows={2}
            className={TEXTAREA_CLASS_NAME}
            placeholder="Add a note"
          />
        </div>
      ) : (
        <textarea
          value={replyBody}
          onChange={(event) => draft.setBody(event.target.value)}
          rows={2}
          className={TEXTAREA_CLASS_NAME}
          placeholder="Reply"
        />
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelDraft}
          disabled={replying}
          className="rounded-full px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5"
        >
          Cancel
        </button>
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
