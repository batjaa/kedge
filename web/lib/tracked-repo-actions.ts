// The tracked-repo row's mutating actions (SPEC §16, M3.6, #94), lifted out of the
// row as pure cores so the re-scan and delete behaviour test without a DOM — the
// same functional-core / imperative-shell split as import-retry.ts. The row injects
// React state setters and the settle/remove callbacks; tests inject stubs.

import type { DeleteTrackedRepoOutcome, RescanOutcome } from './tracked-repos-client';
import type { TrackedRepo } from './tracked-repo-scan';

/**
 * Trigger a re-scan, guarding against a double-press while one request is in
 * flight. On success the caller flips the record in-flight (so the existing poll
 * takes over); on failure the message surfaces in place. The pending flag clears
 * either way — the row stays interactive.
 */
export async function runRescan({
  id,
  pending,
  rescan,
  setPending,
  setError,
  onRescanned,
}: {
  id: number;
  pending: boolean;
  rescan: (id: number) => Promise<RescanOutcome>;
  setPending: (value: boolean) => void;
  setError: (message: string | null) => void;
  onRescanned: (repo: TrackedRepo) => void;
}): Promise<void> {
  if (pending) return;
  setPending(true);
  setError(null);

  const outcome = await rescan(id);
  if (outcome.ok) {
    onRescanned(outcome.trackedRepo);
    setPending(false);
    return;
  }

  setError(outcome.message);
  setPending(false);
}

/**
 * Delete the tracked repo, guarding against a double-press. On success the caller
 * removes the row (so the pending flag is left set — the row unmounts); a 409
 * conflict (a scan is running, 7A) or any other failure surfaces its message and
 * clears pending so the author can wait and retry.
 */
export async function runDelete({
  id,
  pending,
  remove,
  setPending,
  setError,
  onRemoved,
}: {
  id: number;
  pending: boolean;
  remove: (id: number) => Promise<DeleteTrackedRepoOutcome>;
  setPending: (value: boolean) => void;
  setError: (message: string | null) => void;
  onRemoved: (id: number) => void;
}): Promise<void> {
  if (pending) return;
  setPending(true);
  setError(null);

  const outcome = await remove(id);
  if (outcome.ok) {
    onRemoved(id);
    return;
  }

  setError(outcome.message);
  setPending(false);
}
