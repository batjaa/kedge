// The tracked-repo row's mutating actions (SPEC §16, M3.6, #94), lifted out of the
// row as pure cores so the re-scan and delete behaviour test without a DOM — the
// same functional-core / imperative-shell split as import-retry.ts. The row injects
// React state setters and the settle/remove callbacks; tests inject stubs.

import type { DeleteTrackedRepoOutcome, RescanOutcome } from './tracked-repos-client';
import type { TrackedRepo } from './tracked-repo-scan';

/** The minimum shape every row action's outcome shares. */
type RowActionOutcome = { ok: true } | { ok: false; message: string };

/**
 * The shared core for a row's one-shot mutating action (re-scan, delete): guard a
 * double-press, mark pending, run the request, and surface success or failure — the
 * two are structural twins, so they share this. Crucially it is wrapped so a
 * REJECTED fetch (a network blip, not a mapped `{ok:false}`) can never wedge
 * `pending` forever: the catch clears it and surfaces a message, exactly as a mapped
 * failure does. On success `pending` clears unless the caller opts out (delete
 * unmounts the row, so it leaves the flag set).
 */
async function runRowAction<O extends RowActionOutcome>({
  pending,
  setPending,
  setError,
  perform,
  onSuccess,
  clearPendingOnSuccess = true,
  failureMessage,
}: {
  pending: boolean;
  setPending: (value: boolean) => void;
  setError: (message: string | null) => void;
  perform: () => Promise<O>;
  onSuccess: (outcome: Extract<O, { ok: true }>) => void;
  clearPendingOnSuccess?: boolean;
  failureMessage: string;
}): Promise<void> {
  if (pending) return;
  setPending(true);
  setError(null);

  try {
    const outcome = await perform();

    if (outcome.ok) {
      onSuccess(outcome as Extract<O, { ok: true }>);
      if (clearPendingOnSuccess) setPending(false);
      return;
    }

    setError(outcome.message);
    setPending(false);
  } catch {
    // A rejected fetch would otherwise leave the row stuck spinning — clear pending
    // and surface a message so the author can retry.
    setError(failureMessage);
    setPending(false);
  }
}

/**
 * Trigger a re-scan, guarding against a double-press while one request is in
 * flight. On success the caller flips the record in-flight (so the existing poll
 * takes over); on failure — mapped or a rejected fetch — the message surfaces in
 * place and the row stays interactive.
 */
export function runRescan({
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
  return runRowAction<RescanOutcome>({
    pending,
    setPending,
    setError,
    perform: () => rescan(id),
    onSuccess: (outcome) => onRescanned(outcome.trackedRepo),
    failureMessage: 'Could not start the re-scan. Please try again.',
  });
}

/**
 * Delete the tracked repo, guarding against a double-press. On success the caller
 * removes the row (so the pending flag is left set — the row unmounts); a 409
 * conflict (a scan is running, 7A), any other mapped failure, or a rejected fetch
 * surfaces its message and clears pending so the author can wait and retry.
 */
export function runDelete({
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
  return runRowAction<DeleteTrackedRepoOutcome>({
    pending,
    setPending,
    setError,
    perform: () => remove(id),
    onSuccess: () => onRemoved(id),
    // The row unmounts on success — leave pending set rather than flip a gone row.
    clearPendingOnSuccess: false,
    failureMessage: 'Could not remove this tracked repo. Please try again.',
  });
}
