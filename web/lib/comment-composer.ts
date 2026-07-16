import type { CommentType } from './thread-types';

export interface CommentComposerSubmitInput {
  commentType: CommentType;
  canSuggest: boolean;
  body: string;
  proposedText: string;
  anchorExact?: string | null;
  submitting?: boolean;
}

export interface CommentComposerSubmitState {
  isSuggestion: boolean;
  trimmedBody: string;
  trimmedProposedText: string;
  suggestionUnchanged: boolean;
  submitDisabled: boolean;
}

export function commentComposerSubmitState(input: CommentComposerSubmitInput): CommentComposerSubmitState {
  const isSuggestion = input.canSuggest && input.commentType === 'suggestion';
  const trimmedBody = input.body.trim();
  const trimmedProposedText = input.proposedText.trim();
  const suggestionUnchanged = isSuggestion && trimmedProposedText === (input.anchorExact ?? '').trim();
  const missingRequiredText = isSuggestion
    ? trimmedProposedText === '' || suggestionUnchanged
    : trimmedBody === '';

  return {
    isSuggestion,
    trimmedBody,
    trimmedProposedText,
    suggestionUnchanged,
    submitDisabled: Boolean(input.submitting) || missingRequiredText,
  };
}
