import type { AiRun, AiRunStatus } from './ai-types';

/**
 * Pure run-state helpers for the AI panel (SPEC §14, M4). Kept out of the
 * component so the poller's transitions and the taking-too-long ceiling are
 * unit-tested without a DOM.
 */

/**
 * The client's independent ceiling (m4 eng review §6). The server can't be the
 * only guard: a worker killed hard enough never runs its terminal handler, and
 * the run would poll forever. Past this, the panel says so and offers a retry —
 * the run row is left exactly as it is, because only the server may write it.
 *
 * Comfortably longer than the API's own job timeout so the server's honest
 * `failed` normally wins the race and the user sees the real error.
 */
export const AI_RUN_TAKING_TOO_LONG_MS = 360_000;

/** Statuses that mean the run is still on its way to an answer. */
export function isAiRunInFlight(status: AiRunStatus): boolean {
  return status === 'pending' || status === 'running';
}

/**
 * The poll predicate: `null` keeps the loop alive (still in flight, or a dropped
 * read), a run settles it.
 */
export function aiRunSettled(run: AiRun | null): AiRun | null {
  if (run === null) return null;

  return isAiRunInFlight(run.status) ? null : run;
}

export type DigestPhase = 'idle' | 'running' | 'taking-too-long' | 'completed' | 'failed';

/**
 * What the panel renders. Elapsed time is measured from the run's own
 * `created_at`, so re-attaching to a run abandoned yesterday reports
 * taking-too-long immediately instead of pretending it just started.
 */
export function digestPhase(run: AiRun | null, nowMs: number): DigestPhase {
  if (run === null) return 'idle';
  if (run.status === 'completed') return 'completed';
  if (run.status === 'failed') return 'failed';

  const startedAt = Date.parse(run.created_at);
  const elapsed = Number.isNaN(startedAt) ? 0 : nowMs - startedAt;

  return elapsed >= AI_RUN_TAKING_TOO_LONG_MS ? 'taking-too-long' : 'running';
}

/**
 * Whether the panel offers a generate/retry button. Everything except a healthy
 * in-flight run does: a terminal run starts a NEW run, and a run past the client
 * ceiling re-requests — which the server dedupes back to the same run if it is
 * genuinely still working, so the button is honest either way.
 */
export function canRequestDigest(phase: DigestPhase): boolean {
  return phase !== 'running';
}
