'use client';

import { useState } from 'react';
import { MessageSquare, Pencil, Send } from 'lucide-react';
import { ModeButton, TEXTAREA_CLASS_NAME } from './document-thread-ui';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { ReviewThread } from '@/lib/thread-types';

export function ReplyComposer({
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
  const trimmedProposedText = proposedText.trim();
  const suggestionUnchanged = isSuggestion && trimmedProposedText === thread.anchor?.exact.trim();
  const submitDisabled = replying
    || (isSuggestion ? trimmedProposedText === '' || suggestionUnchanged : replyBody.trim() === '');

  async function submitReply() {
    if (submitDisabled) return;
    onMessage(null);
    setReplying(true);
    const error = isSuggestion
      ? await onReply(thread, {
          comment_type: 'suggestion',
          body: replyBody.trim() === '' ? undefined : replyBody.trim(),
          proposed_text: trimmedProposedText,
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
