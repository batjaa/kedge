import type { AnchorSelector } from './anchor-capture-core';
import type { AskQuote } from './ai-types';

/**
 * Pure helpers behind ask-about-the-doc (M4 #139). Kept out of the component so
 * the rules are testable without a DOM, per the module spec's web testing seam.
 */

/**
 * The longest question the api will accept
 * (`StoreDocumentAskRequest::MAX_QUESTION_CHARS`). Mirrored here so the textarea
 * stops at the limit rather than letting a reader write past it and be told 422
 * afterwards — keep the two in step.
 */
export const MAX_ASK_QUESTION_CHARS = 1000;

/** How much of a selected passage the panel shows back before eliding. */
export const ASK_QUOTE_PREVIEW_CHARS = 240;

/**
 * Whether this text is a question worth spending a model call on.
 *
 * Whitespace-only is not: the api trims and rejects it, and asking anyway would
 * bill the workspace's key to be told 422. Over-length is not either — the
 * textarea caps input, but a paste can still arrive over the line.
 */
export function askQuestionIsAskable(question: string): boolean {
  const trimmed = question.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_ASK_QUESTION_CHARS;
}

/**
 * The passage as the panel shows it back, so the reader can see WHICH selection
 * their question is about before they spend a call on it.
 *
 * An elided preview is marked with an ellipsis: what the model receives is the
 * full passage (the api does its own, separately marked, cut at a much larger
 * ceiling), so this must never read as though the selection itself were short.
 */
export function askQuotePreview(exact: string, limit = ASK_QUOTE_PREVIEW_CHARS): string {
  const collapsed = exact.replace(/\s+/g, ' ').trim();

  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit).trimEnd()}…`;
}

/**
 * The ask payload for a captured selection.
 *
 * Deliberately narrower than the capture: an ask persists no anchor and
 * re-anchors nothing, so the offsets and projection version the capture carries
 * have nothing to be validated against. Sending them would invite a reader — or
 * a later reviewer of this code — to believe the answer is pinned to a version
 * when it is only quoted from one.
 */
export function askQuoteFromSelector(selector: AnchorSelector): AskQuote {
  return {
    exact: selector.exact,
    heading_path: selector.heading_path,
  };
}
