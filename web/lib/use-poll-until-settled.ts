'use client';

import { useEffect, useRef, type Key } from 'react';

/**
 * The single cadence for every poll-until-settled loop (12A). One home for the
 * interval RowPoller, DocumentPoller, and SharedDocumentPoller share today — and
 * the tracked-repo panel joins next (#93) — so "how often do we poll?" is
 * answered in exactly one place instead of a literal copied per poller.
 */
export const POLL_INTERVAL_MS = 1500;

/** The loop's next move once a read resolves, given whether it was torn down. */
export type PollStep<T> =
  | { kind: 'settle'; payload: T }
  | { kind: 'continue' }
  | { kind: 'abort' };

/**
 * The functional core of every poller (12A): given whether the effect was torn
 * down while the read was in flight, and the read's outcome, decide the loop's
 * next move. `null` is the shared "keep polling" signal — each consumer maps its
 * own transient failure to it (RowPoller via readDocument→null; DocumentPoller /
 * SharedDocumentPoller via an inline try/catch), so this never owns the catch and
 * never weakens either. Cancellation wins over everything: a read that resolves
 * after teardown neither settles nor reschedules — the guard each of the three
 * cleanup functions hand-rolled, made uniform.
 */
export function pollStep<T>(cancelled: boolean, result: T | null): PollStep<T> {
  if (cancelled) return { kind: 'abort' };
  if (result === null) return { kind: 'continue' };
  return { kind: 'settle', payload: result };
}

/**
 * One tick of the loop, with every side effect injected so it runs — and is
 * tested — without a DOM or a timer (import-retry.ts's runImportRetry idiom).
 * Reads once, routes the outcome through {@link pollStep}, then either settles or
 * reschedules. `isCancelled` is re-read *after* the await so a teardown during the
 * read still aborts before any settle or reschedule.
 */
export async function pollTick<T>({
  poll,
  onSettled,
  reschedule,
  isCancelled,
}: {
  poll: () => Promise<T | null>;
  onSettled: (payload: T) => void;
  reschedule: () => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const result = await poll();
  const step = pollStep(isCancelled(), result);

  if (step.kind === 'abort') return;
  if (step.kind === 'settle') {
    onSettled(step.payload);
    return;
  }

  reschedule();
}

/**
 * The timer/settle/cleanup skeleton every in-flight poller shares (12A), lifted
 * out of the hook so it runs — and is tested — with the scheduler injected, no
 * DOM and no real timer (pollTick's idiom, one level up). Schedules the first
 * tick, keeps the loop alive on a `null` read and settles it once on a non-null
 * one, and returns a teardown that cancels the loop so a read resolving after
 * teardown neither settles nor reschedules.
 *
 * The poll and onSettled callbacks are read through getters at *tick* time, never
 * captured when the loop starts, so a consumer that re-renders with fresh
 * closures can never poll a stale one — the hook feeds these getters off refs it
 * refreshes every render, which is what lets its dependency list shrink to the
 * poll `key` alone.
 */
export function startPollLoop<T>({
  getPoll,
  getOnSettled,
  schedule,
  cancel,
}: {
  getPoll: () => () => Promise<T | null>;
  getOnSettled: () => (payload: T) => void;
  schedule: (run: () => void) => void;
  cancel: () => void;
}): () => void {
  let cancelled = false;

  const tick = () =>
    pollTick({
      // Resolve the callbacks *now*, not at loop start — the latest render wins.
      poll: () => getPoll()(),
      // Settling also latches `cancelled` so a stray resolve can never re-enter
      // — the `stopped = true` each poller set on its terminal read.
      onSettled: (payload) => {
        cancelled = true;
        getOnSettled()(payload);
      },
      reschedule: () => schedule(tick),
      isCancelled: () => cancelled,
    });

  schedule(tick);

  return () => {
    cancelled = true;
    cancel();
  };
}

/**
 * Poll-until-settled: the timer/settle/cleanup skeleton every in-flight poller
 * shares (12A). Schedules `poll` on the shared {@link POLL_INTERVAL_MS} cadence; a
 * `null` read keeps the loop alive, a non-null read settles it once through
 * `onSettled` and stops. Cleanup cancels the loop so a read that resolves after
 * teardown neither settles nor reschedules. Behaviour only — renders nothing.
 *
 * `poll` and `onSettled` are held in refs refreshed every render and read at tick
 * time, so a caller can never silently poll a stale closure — the failure mode of
 * the old caller-owned effect-deps array. The loop restarts only when `key` — the
 * poll target (a document id, share token, or tracked-repo id) — changes, so
 * there is no dependency list for a consumer to get wrong (and no eslint-disable).
 */
export function usePollUntilSettled<T>({
  poll,
  onSettled,
  key,
}: {
  poll: () => Promise<T | null>;
  onSettled: (payload: T) => void;
  key: Key;
}): void {
  const pollRef = useRef(poll);
  const onSettledRef = useRef(onSettled);

  // Keep the refs pointed at the latest render's closures. Ticks fire a cadence
  // later via setTimeout, so by the time one runs the refs are always current.
  useEffect(() => {
    pollRef.current = poll;
    onSettledRef.current = onSettled;
  });

  // Restart only when the poll target changes. poll/onSettled are read from refs,
  // so they are deliberately not dependencies — the loop keeps running across a
  // callback-identity change and simply calls the fresh one on the next tick.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    return startPollLoop<T>({
      getPoll: () => pollRef.current,
      getOnSettled: () => onSettledRef.current,
      schedule: (run) => {
        timer = setTimeout(run, POLL_INTERVAL_MS);
      },
      cancel: () => clearTimeout(timer),
    });
  }, [key]);
}
