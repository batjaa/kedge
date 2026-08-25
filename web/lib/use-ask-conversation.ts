'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { startAsk } from './ai-client';
import { askQuestionIsAskable } from './ai-ask';
import {
  askConversationIsBusy,
  askConversationPollRunId,
  askTurnIsRetryable,
  replayableTranscript,
  type AskTurn,
} from './ask-conversation';
import type { AiRun, AskOutput, AskQuote } from './ai-types';

/**
 * The ask conversation's state and lifecycle (M4 #151).
 *
 * It lives in a HOOK the review surface calls, not inside the chat panel,
 * because the panel unmounts and the conversation must not. Closing the panel
 * and reopening it returns the reader to their conversation; only "New
 * conversation" and a page reload clear it. (In #139 the opposite was true and
 * deliberate — the dialog owned the answer, so closing it destroyed the answer.
 * That is exactly the behaviour this ticket reverses.)
 *
 * The poll loop is the surface's too, for the same reason one level down: a
 * reader who closes the panel while a question is in flight has already spent
 * the workspace's key, and reopening should show them the answer rather than a
 * turn stuck on "thinking" because nobody was listening.
 */
export interface AskConversation {
  /** Every turn asked this page session, oldest first — including failed ones. */
  turns: AskTurn[];
  /** The passage the NEXT question will carry, shown as a removable chip. */
  pendingQuote: AskQuote | null;
  /** Whether a turn is waiting on the model; the composer is disabled while true. */
  busy: boolean;
  /** The one in-flight run to poll, or null. */
  pollRunId: number | null;
  /**
   * Ask the next question. Returns whether it was ACCEPTED — the composer must
   * not clear a draft the conversation silently dropped (a send racing a reset
   * used to do exactly that).
   */
  ask: (question: string) => boolean;
  /**
   * Retry one turn. Only the LAST turn is retryable; see the guard below for
   * why a middle turn is not.
   */
  retry: (turnId: number) => void;
  attachQuote: (quote: AskQuote | null) => void;
  clearPendingQuote: () => void;
  /** "New conversation": forget the turns and any pending passage. */
  reset: () => void;
  /** Fold a settled run back onto the turn that started it. */
  settle: (run: AiRun<AskOutput>) => void;
}

export function useAskConversation(documentId: number): AskConversation {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [pendingQuote, setPendingQuote] = useState<AskQuote | null>(null);

  // Read during send so a question always carries the conversation as it stands
  // right now, never the render the handler happened to close over. Assigned in
  // the render body rather than an effect: an effect runs after paint, and a
  // send fired in the same tick would read a stale list.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  // One send at a time. The busy flag disables the composer, but a double
  // submit (Enter held, a double click) can still fire twice before React
  // re-renders — and two runs for one question is real money.
  const sendingRef = useRef(false);
  const nextIdRef = useRef(1);

  // Which conversation a send belongs to. "New conversation" bumps it, so a
  // POST that was already in flight lands on an epoch nobody is looking at and
  // is discarded instead of appearing as the first turn of the fresh
  // conversation — and, just as importantly, instead of leaving `sendingRef`
  // latched so the next question is silently swallowed.
  const epochRef = useRef(0);

  const busy = useMemo(() => askConversationIsBusy(turns), [turns]);
  const pollRunId = useMemo(() => askConversationPollRunId(turns), [turns]);

  /**
   * Start a run for one turn and fold the outcome back onto it.
   *
   * Every write is keyed by turn id, never by index: a turn can be retried
   * while this is in flight, and an index would land the result on whatever
   * happens to sit there now.
   */
  const start = useCallback(async (
    turnId: number,
    question: string,
    quote: AskQuote | null,
    history: AskTurn[],
  ) => {
    const epoch = epochRef.current;
    sendingRef.current = true;

    const outcome = await startAsk(documentId, question, quote, replayableTranscript(history));

    // The conversation this send belonged to is gone. Leave `sendingRef` alone
    // — the reset already cleared it, and a later send may legitimately own it
    // by now — and drop the result rather than folding it into a conversation
    // that never asked the question. The run itself is abandoned exactly as
    // closing the tab would abandon it.
    if (epoch !== epochRef.current) return;

    sendingRef.current = false;

    setTurns((current) => current.map((turn) => {
      if (turn.id !== turnId) return turn;

      return outcome.ok
        ? { ...turn, starting: false, run: outcome.run as AiRun<AskOutput>, startFailure: null }
        : { ...turn, starting: false, run: null, startFailure: outcome };
    }));
  }, [documentId]);

  const ask = useCallback((question: string): boolean => {
    const trimmed = question.trim();

    if (sendingRef.current || !askQuestionIsAskable(trimmed)) return false;
    if (askConversationIsBusy(turnsRef.current)) return false;

    const history = turnsRef.current;
    const id = nextIdRef.current++;
    // The passage travels with THIS turn and stops being pending the moment it
    // is spent — a chip that survived its own question would silently re-attach
    // to the next one.
    const quote = pendingQuote;

    setTurns((current) => [
      ...current,
      { id, question: trimmed, quote, starting: true, run: null, startFailure: null },
    ]);
    setPendingQuote(null);

    void start(id, trimmed, quote, history);

    return true;
  }, [pendingQuote, start]);

  const retry = useCallback((turnId: number) => {
    if (sendingRef.current) return;

    // The ordering rule lives in `askTurnIsRetryable`, so the hook and the
    // panel cannot disagree about which turn offers the button.
    if (!askTurnIsRetryable(turnsRef.current, turnId)) return;

    const index = turnsRef.current.findIndex((turn) => turn.id === turnId);
    const turn = turnsRef.current[index];
    // The history is what came BEFORE this question — a turn must never replay
    // itself. With retry pinned to the last turn, that is every earlier turn.
    const history = turnsRef.current.slice(0, index);

    setTurns((current) => current.map((existing) => existing.id === turnId
      // The old run id goes with it, which is what makes a late poll of the
      // superseded run land on nothing (see `settle`).
      ? { ...existing, starting: true, run: null, startFailure: null }
      : existing));

    void start(turnId, turn.question, turn.quote, history);
  }, [start]);

  const settle = useCallback((run: AiRun<AskOutput>) => {
    // Matched by RUN id, not by turn: a poll that resolves after its turn was
    // retried finds no turn holding that run and is dropped, so a superseded
    // answer can never overwrite the fresh one.
    setTurns((current) => current.map((turn) => (
      turn.run?.id === run.id ? { ...turn, run } : turn
    )));
  }, []);

  const reset = useCallback(() => {
    // Bumping the epoch is what makes this safe mid-flight: a POST already on
    // the wire lands on an epoch nobody is looking at and is dropped. Clearing
    // `sendingRef` alongside it is the other half — leaving it latched left the
    // panel accepting questions it silently threw away.
    epochRef.current += 1;
    sendingRef.current = false;
    setTurns([]);
    setPendingQuote(null);
    nextIdRef.current = 1;
  }, []);

  return {
    turns,
    pendingQuote,
    busy,
    pollRunId,
    ask,
    retry,
    attachQuote: setPendingQuote,
    clearPendingQuote: () => setPendingQuote(null),
    reset,
    settle,
  };
}
