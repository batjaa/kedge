import type { AnchorSelector } from './anchor-capture-core';
import { commentComposerSubmitState } from './comment-composer';
import type {
  CreateThreadInput,
  CreateThreadOutcome,
  ReplyToThreadInput,
} from './comments-client';
import type { CommentType, ReviewThread, ThreadAnchorPayload } from './thread-types';

export type DraftPostResult<T> =
  | { status: 'invalid'; suggestionUnchanged: boolean }
  | { status: 'failed'; message: string }
  | { status: 'posted'; value: T };

export interface DocumentComposerDraftSnapshot {
  mode: 'inline' | 'document';
  commentType: CommentType;
  anchor: AnchorSelector | null;
  failedCapture: boolean;
  body: string;
  proposedText: string;
  idempotencyKey: string;
}

export interface ReplyComposerDraftSnapshot {
  commentType: CommentType;
  body: string;
  proposedText: string;
  idempotencyKey: string;
}

export async function postDocumentComposerDraft({
  documentId,
  documentVersionId,
  draft,
  createThread,
  createSuggestionThread,
}: {
  documentId: number;
  documentVersionId?: number;
  draft: DocumentComposerDraftSnapshot;
  createThread: (documentId: number, input: CreateThreadInput) => Promise<CreateThreadOutcome>;
  createSuggestionThread: (
    documentId: number,
    input: {
      body?: string;
      proposed_text: string;
      anchor: ThreadAnchorPayload;
      idempotency_key: string;
      document_version_id?: number;
    },
  ) => Promise<CreateThreadOutcome>;
}): Promise<DraftPostResult<ReviewThread>> {
  const canSuggest = draft.mode === 'inline' && draft.anchor != null && !draft.failedCapture;
  const submitState = commentComposerSubmitState({
    canSuggest,
    commentType: draft.commentType,
    body: draft.body,
    proposedText: draft.proposedText,
    anchorExact: draft.anchor?.exact,
  });

  if (submitState.submitDisabled) {
    return { status: 'invalid', suggestionUnchanged: submitState.suggestionUnchanged };
  }

  const anchor = draft.mode === 'inline' && draft.anchor
    ? {
        ...draft.anchor,
        projection_version: String(draft.anchor.projection_version),
      }
    : null;

  const outcome = submitState.isSuggestion && anchor
    ? await createSuggestionThread(documentId, {
        body: draft.body.trim() === '' ? undefined : draft.body,
        proposed_text: submitState.trimmedProposedText,
        anchor,
        idempotency_key: draft.idempotencyKey,
        document_version_id: documentVersionId,
      })
    : draft.mode === 'inline' && anchor
      ? await createThread(documentId, {
          type: 'inline',
          body: draft.body,
          anchor,
          idempotency_key: draft.idempotencyKey,
          document_version_id: documentVersionId,
        })
      : await createThread(documentId, {
          type: 'document',
          body: draft.body,
          failed_capture: draft.failedCapture,
          idempotency_key: draft.idempotencyKey,
          document_version_id: documentVersionId,
        });

  if (!outcome.ok) return { status: 'failed', message: outcome.message };

  return { status: 'posted', value: outcome.thread };
}

export async function postReplyComposerDraft({
  thread,
  draft,
  onReply,
}: {
  thread: ReviewThread;
  draft: ReplyComposerDraftSnapshot;
  onReply: (thread: ReviewThread, input: ReplyToThreadInput, idempotencyKey: string) => Promise<string | null>;
}): Promise<DraftPostResult<null>> {
  const canSuggest = thread.type === 'inline' && thread.anchor !== null;
  const submitState = commentComposerSubmitState({
    canSuggest,
    commentType: draft.commentType,
    body: draft.body,
    proposedText: draft.proposedText,
    anchorExact: thread.anchor?.exact,
  });

  if (submitState.submitDisabled) {
    return { status: 'invalid', suggestionUnchanged: submitState.suggestionUnchanged };
  }

  const error = submitState.isSuggestion
    ? await onReply(thread, {
        comment_type: 'suggestion',
        body: draft.body.trim() === '' ? undefined : draft.body.trim(),
        proposed_text: submitState.trimmedProposedText,
      }, draft.idempotencyKey)
    : await onReply(thread, { body: submitState.trimmedBody }, draft.idempotencyKey);

  if (error) return { status: 'failed', message: error };

  return { status: 'posted', value: null };
}
