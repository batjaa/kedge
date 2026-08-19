'use client';

import { useRef, useState } from 'react';
import { MessageSquare, Pencil, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiReplyDraftAction } from './ai-reply-draft';
import { ModeButton, TEXTAREA_CLASS_NAME } from './document-thread-ui';
import { MentionTextarea } from './mention-textarea';
import { useAiEnabled } from '@/lib/ai-capability';
import { commentComposerSubmitState } from '@/lib/comment-composer';
import { postReplyComposerDraft } from '@/lib/comment-composer-actions';
import { commentDraftContextKey, useCommentDraft } from '@/lib/comment-draft';
import type { ReplyToThreadInput } from '@/lib/comments-client';
import type { CommentType, ReviewThread } from '@/lib/thread-types';

export function ReplyComposer({
  thread,
  onReply,
  onMessage,
}: {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
  onMessage: (message: string | null) => void;
}) {
  const t = useTranslations('threads');
  const aiEnabled = useAiEnabled();
  const [replying, setReplying] = useState(false);
  const replyingRef = useRef(false);
  const canSuggest = thread.type === 'inline' && thread.anchor !== null;
  const draft = useCommentDraft(
    commentDraftContextKey({
      documentId: thread.document_id,
      target: { type: 'thread', threadId: thread.id },
    }),
    {
      initialMode: 'comment',
      initialProposedText: thread.anchor?.exact ?? '',
    },
  );
  const commentType = canSuggest ? draft.mode : 'comment';
  const replyBody = draft.body;
  const proposedText = draft.proposedText;
  const submitState = commentComposerSubmitState({
    canSuggest,
    commentType,
    body: replyBody,
    proposedText,
    anchorExact: thread.anchor?.exact,
    submitting: replying,
  });
  const { isSuggestion, suggestionUnchanged, submitDisabled } = submitState;

  async function submitReply() {
    if (submitDisabled || replyingRef.current) return;
    onMessage(null);
    replyingRef.current = true;
    setReplying(true);
    try {
      const result = await postReplyComposerDraft({
        thread,
        draft: {
          commentType,
          body: replyBody,
          proposedText,
          idempotencyKey: draft.idempotencyKey,
        },
        onReply,
      });
      if (result.status === 'failed') {
        onMessage(result.message);
        return;
      }
      if (result.status === 'invalid') return;

      draft.clear();
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

  function setDraftMode(mode: CommentType) {
    if (replyingRef.current) return;
    if (mode === 'suggestion' && draft.proposedText === '' && thread.anchor) {
      draft.setProposedText(thread.anchor.exact);
    }
    draft.setMode(mode);
  }

  return (
    <div className="mt-4 border-t border-zinc-900/5 pt-3 dark:border-white/5">
      {thread.status === 'resolved' ? (
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">{t('composer.resolvedReopen')}</p>
      ) : null}
      {canSuggest ? (
        <div className="mb-2 grid w-full grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
          <ModeButton active={!isSuggestion} disabled={replying} onClick={() => setDraftMode('comment')}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {t('composer.comment')}
          </ModeButton>
          <ModeButton
            active={isSuggestion}
            disabled={replying}
            onClick={() => setDraftMode('suggestion')}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t('composer.suggest')}
          </ModeButton>
        </div>
      ) : null}
      {isSuggestion ? (
        <div className="space-y-2">
          <textarea
            value={proposedText}
            onChange={(event) => {
              if (!replyingRef.current) draft.setProposedText(event.target.value);
            }}
            rows={3}
            className={TEXTAREA_CLASS_NAME}
            placeholder={t('composer.replacementText')}
            aria-label={t('composer.replySuggestedReplacement')}
            disabled={replying}
          />
          {suggestionUnchanged ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('composer.suggestionUnchanged')}</p>
          ) : null}
          <MentionTextarea
            documentId={thread.document_id}
            value={replyBody}
            onChange={(nextBody) => {
              if (!replyingRef.current) draft.setBody(nextBody);
            }}
            rows={2}
            className={TEXTAREA_CLASS_NAME}
            placeholder={t('composer.addNote')}
            ariaLabel={t('composer.replySuggestionNote')}
            disabled={replying}
          />
        </div>
      ) : (
        <MentionTextarea
          documentId={thread.document_id}
          value={replyBody}
          onChange={(nextBody) => {
            if (!replyingRef.current) draft.setBody(nextBody);
          }}
          rows={2}
          className={TEXTAREA_CLASS_NAME}
          placeholder={t('composer.reply')}
          ariaLabel={t('composer.reply')}
          disabled={replying}
        />
      )}
      {/* The AI triage footer (#133). Absent entirely on an instance with no
          Anthropic key — the affordance never renders, rather than 404ing. It
          writes into this composer's draft and nothing else: posting stays the
          Reply button below. */}
      {aiEnabled ? (
        <AiReplyDraftAction
          threadId={thread.id}
          composerBody={replyBody}
          disabled={replying}
          onInsert={(body) => {
            if (!replyingRef.current) draft.setBody(body);
          }}
        />
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelDraft}
          disabled={replying}
          className="rounded-full px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5"
        >
          {t('composer.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submitReply()}
          disabled={submitDisabled}
          aria-label={isSuggestion ? t('composer.submitSuggestionReply') : t('composer.postReply')}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {isSuggestion ? t('composer.suggest') : t('composer.reply')}
        </button>
      </div>
    </div>
  );
}
