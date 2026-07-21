'use client';

import { useEffect, type DependencyList } from 'react';

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
 * Poll-until-settled: the timer/settle/cleanup skeleton every in-flight poller
 * shares (12A). Schedules `poll` on the shared {@link POLL_INTERVAL_MS} cadence; a
 * `null` read keeps the loop alive, a non-null read settles it once through
 * `onSettled` and stops. Cleanup cancels the loop so a read that resolves after
 * teardown neither settles nor reschedules. `deps` is the caller's own dependency
 * list (e.g. `[id, onSettled]`): the loop tears down and restarts when it changes,
 * exactly as each hand-rolled poller did. Behaviour only — renders nothing.
 */
export function usePollUntilSettled<T>({
  poll,
  onSettled,
  deps,
}: {
  poll: () => Promise<T | null>;
  onSettled: (payload: T) => void;
  deps: DependencyList;
}): void {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () =>
      pollTick({
        poll,
        // Settling also latches `cancelled` so a stray resolve can never re-enter
        // — the `stopped = true` each poller set on its terminal read.
        onSettled: (payload) => {
          cancelled = true;
          onSettled(payload);
        },
        reschedule: () => {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        },
        isCancelled: () => cancelled,
      });

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `deps` is the caller's dependency list; poll/onSettled are re-read on every
    // restart it triggers, matching each poller's original [id, …] effect deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
