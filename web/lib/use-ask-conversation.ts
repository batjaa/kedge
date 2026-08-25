'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { startAsk } from './ai-client';
import { askQuestionIsAskable } from './ai-ask';
import {
  askConversationIsBusy,
  askConversationPollRunId,
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
  ask: (question: string) => void;
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
    sendingRef.current = true;

    const outcome = await startAsk(documentId, question, quote, replayableTranscript(history));

    sendingRef.current = false;

    setTurns((current) => current.map((turn) => {
      if (turn.id !== turnId) return turn;

      return outcome.ok
        ? { ...turn, starting: false, run: outcome.run as AiRun<AskOutput>, startFailure: null }
        : { ...turn, starting: false, run: null, startFailure: outcome };
    }));
  }, [documentId]);

  const ask = useCallback((question: string) => {
    const trimmed = question.trim();

    if (sendingRef.current || !askQuestionIsAskable(trimmed)) return;
    if (askConversationIsBusy(turnsRef.current)) return;

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
  }, [pendingQuote, start]);

  const retry = useCallback((turnId: number) => {
    if (sendingRef.current) return;
    if (askConversationIsBusy(turnsRef.current)) return;

    const index = turnsRef.current.findIndex((turn) => turn.id === turnId);
    if (index === -1) return;

    const turn = turnsRef.current[index];
    // The history is what came BEFORE this question, not the whole list: a turn
    // must never replay itself, and the turns after it (if a later one somehow
    // exists) were not context for it when it was asked.
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
