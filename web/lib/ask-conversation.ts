import { askTurnAnswerText } from './ai-ask';
import { isAiRunInFlight } from './ai-run';
import type { StartRunFailure } from './ai-client';
import type { AiRun, AskOutput, AskQuote } from './ai-types';

/**
 * The ask conversation, as pure data (M4 #151).
 *
 * The transcript lives in client memory for the page session and NOWHERE else:
 * there is no conversation table, no `parent_run_id`, and no read path that
 * could hand it back after a reload. That is a deliberate trade (TODOS decision
 * log) — it costs resume-across-reload and buys the two properties #139
 * established and this ticket had to keep: the server has no ask to read, so
 * per-actor privacy needs no new policy, and the ledger never becomes somewhere
 * to go and read someone's questions.
 *
 * The rules for what gets REPLAYED live here rather than in the panel, so they
 * are testable without a DOM and so the client's half of the double cap is one
 * function rather than a condition spread across a component.
 */

/**
 * How many prior turns a follow-up replays, mirroring
 * `StoreDocumentAskRequest::MAX_TRANSCRIPT_TURNS`. Keep the two in step: past
 * this the endpoint 422s, and a 422 the user cannot see coming is worse than a
 * conversation that quietly forgets its beginning.
 */
export const MAX_ASK_TRANSCRIPT_TURNS = 8;

/**
 * The whole replayed transcript's character ceiling, mirroring
 * `StoreDocumentAskRequest::MAX_TRANSCRIPT_CHARS`.
 */
export const MAX_ASK_TRANSCRIPT_CHARS = 16000;

/** One prior turn as the request carries it. */
export interface AskTranscriptTurn {
  question: string;
  answer: string;
}

/**
 * One turn of the conversation on screen.
 *
 * The turn is the QUESTION, not the run: `id` survives a retry, so retrying a
 * failed turn replaces its run in place rather than appending a duplicate
 * question the reader never asked twice.
 */
export interface AskTurn {
  id: number;
  question: string;
  /** The passage this turn was asked about, if any. Shown with the question. */
  quote: AskQuote | null;
  /** True between the POST leaving and its response landing. */
  starting: boolean;
  /** The run, once the POST returned one. Null while starting, or if it never did. */
  run: AiRun<AskOutput> | null;
  /**
   * Why the POST itself failed — a 429, a 403, a dropped connection. Distinct
   * from `run.error`, which is a run that started and then failed: only one of
   * the two can be true, and they read differently to the person.
   */
  startFailure: StartRunFailure | null;
}

/** The answer this turn is showing, or null while it has none. */
export function askTurnOutput(turn: AskTurn): AskOutput | null {
  return turn.run?.status === 'completed' ? turn.run.output ?? null : null;
}

/** Whether this turn is still on its way to an answer. */
export function askTurnIsPending(turn: AskTurn): boolean {
  return turn.starting || (turn.run !== null && isAiRunInFlight(turn.run.status));
}

/**
 * Whether the conversation is waiting on the model.
 *
 * One turn at a time, deliberately: a second question sent while the first is
 * unanswered could not carry it as context, so the answers would arrive out of
 * order against a transcript that never held them.
 */
export function askConversationIsBusy(turns: readonly AskTurn[]): boolean {
  return turns.some(askTurnIsPending);
}

/**
 * The run this conversation is polling, or null.
 *
 * At most one, by the busy rule above — so the surface renders exactly one poll
 * loop, and it lives OUTSIDE the panel so closing the panel mid-question does
 * not abandon the run the workspace already paid for.
 */
export function askConversationPollRunId(turns: readonly AskTurn[]): number | null {
  for (const turn of turns) {
    if (turn.run !== null && isAiRunInFlight(turn.run.status)) return turn.run.id;
  }

  return null;
}

/**
 * Whether this turn may be retried at all — the ORDERING half of the rule; the
 * panel adds the "could a retry even help?" half (a deterministic failure
 * cannot).
 *
 * Only the conversation's last turn qualifies, and that is correctness rather
 * than simplification. A failed turn contributes nothing to the transcript, so
 * a reader can ask a further question while it sits there failed. Retrying it
 * afterwards would slot its answer in FRONT of an answer written without it,
 * and every later request would replay the pair in display order — presenting
 * an answer as though it had been written with context it never saw. Re-asking
 * is the honest way back to a turn the conversation has moved past.
 *
 * A turn whose own run is still in flight is retryable: that is how a reader
 * escapes a run that outlived the client's ceiling, which nothing else will
 * ever settle. An EARLIER turn in flight still blocks — one question at a time.
 */
export function askTurnIsRetryable(turns: readonly AskTurn[], turnId: number): boolean {
  const index = turns.findIndex((turn) => turn.id === turnId);

  if (index === -1 || index !== turns.length - 1) return false;

  return !askConversationIsBusy(turns.slice(0, index));
}

/**
 * The prior turns a new question carries as context — the client half of the
 * double cap (the endpoint and the prompt builder each enforce it again).
 *
 * Three rules, in order:
 *
 *  - **Only answered turns.** A pending or failed turn has no answer, and
 *    replaying "the reader asked X" with nothing after it invites the model to
 *    answer X again instead of the question actually being asked.
 *  - **The newest {@link MAX_ASK_TRANSCRIPT_TURNS}.** Dropped from the REQUEST
 *    only — the panel keeps showing every turn, because a conversation that
 *    visibly deleted its own beginning would look broken rather than thrifty.
 *  - **Then oldest-first until the payload fits.** Same reason: the beginning is
 *    the part later turns have most often superseded.
 *
 * Stricter than the server's builder, on purpose. Where the builder cuts a
 * single irreducible turn to keep SOMETHING, this drops it: the client's job is
 * to never send a payload the endpoint would refuse, and a 422 in the middle of
 * a conversation is a worse outcome than a follow-up that lost its context.
 */
export function replayableTranscript(
  turns: readonly AskTurn[],
  options: { maxTurns?: number; maxChars?: number } = {},
): AskTranscriptTurn[] {
  const maxTurns = Math.max(0, options.maxTurns ?? MAX_ASK_TRANSCRIPT_TURNS);
  const maxChars = Math.max(0, options.maxChars ?? MAX_ASK_TRANSCRIPT_CHARS);

  const answered: AskTranscriptTurn[] = [];

  for (const turn of turns) {
    const question = turn.question.trim();
    const answer = askTurnAnswerText(askTurnOutput(turn)).trim();

    if (question === '' || answer === '') continue;

    answered.push({ question, answer });
  }

  let replay = answered.slice(Math.max(0, answered.length - maxTurns));

  while (replay.length > 0 && transcriptChars(replay) > maxChars) {
    replay = replay.slice(1);
  }

  return replay;
}

/** What a transcript costs against the payload ceiling. */
export function transcriptChars(turns: readonly AskTranscriptTurn[]): number {
  return turns.reduce((total, turn) => total + turn.question.length + turn.answer.length, 0);
}
