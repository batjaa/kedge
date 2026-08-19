/**
 * Pure decision logic for the thread-panel triage pair (M4 #133). Kept out of the
 * components so the one rule that actually protects a person's work — a drafted
 * reply never overwrites what they already typed — is a function with tests, not
 * a branch buried in an effect.
 */

/**
 * How many comments make a thread worth summarizing.
 *
 * Below this, reading it IS the summary: offering an AI call on a three-comment
 * thread costs the workspace's key for something a reviewer can absorb in ten
 * seconds, and it trains people to ignore the affordance. The spec's motivating
 * case is the forty-reply monster; eight is where "scroll and re-read" starts.
 */
export const AI_SUMMARY_MIN_COMMENTS = 8;

export function isLongThread(commentCount: number): boolean {
  return commentCount >= AI_SUMMARY_MIN_COMMENTS;
}

/**
 * What happens to a generated draft when it arrives at the composer.
 *
 * - `insert` — drop it straight in; there was nothing there to lose.
 * - `confirm` — the composer holds the person's own typed text. It is NOT
 *   replaced. The UI asks first, and only an explicit confirmation replaces it
 *   (m4 eng review §12, gap G12).
 * - `discard` — the run completed with nothing usable (everything was over
 *   budget). Inserting an empty string would silently wipe a draft, which is the
 *   exact failure this function exists to prevent.
 *
 * The asymmetry is deliberate: the AI's output is cheap and reproducible, and the
 * human's half-written reply is neither. When in doubt, the human's text wins.
 */
export type ReplyDraftLanding =
  | { action: 'insert'; body: string }
  | { action: 'confirm'; body: string }
  | { action: 'discard' };

export function replyDraftLanding({ composerBody, generated }: {
  composerBody: string;
  generated: string;
}): ReplyDraftLanding {
  const body = generated.trim();

  if (body === '') return { action: 'discard' };

  return composerBody.trim() === ''
    ? { action: 'insert', body }
    : { action: 'confirm', body };
}
