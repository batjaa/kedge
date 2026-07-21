'use client';

import { useState } from 'react';
import { retryImport, type ImportOutcome } from '@/lib/documents-client';

// The API's token-revoked sync_error carries "reconnect" (SPEC §19). A dead PAT
// cannot be healed by retrying, so consumers branch to a reconnect CTA instead
// of a futile retry. Pure so both the doc page and the documents-list row can
// exercise the branch without a DOM.
export function importNeedsReconnect(error: string | null): boolean {
  return Boolean(error && /reconnect/i.test(error));
}

// The retry action, lifted out of ImportFailed so the doc page and the list row
// share one guard-then-retry behaviour (functional core, imperative shell — the
// hook injects React state + the router refresh; tests inject stubs). A click
// while a retry is in flight is dropped; a successful re-queue refreshes the
// surface so it re-enters the importing/poll state; a failure surfaces the
// outcome copy in place.
export async function runImportRetry({
  id,
  pending,
  retry,
  setPending,
  setError,
  onRetried,
}: {
  id: number;
  pending: boolean;
  retry: (id: number) => Promise<ImportOutcome>;
  setPending: (value: boolean) => void;
  setError: (message: string | null) => void;
  onRetried: () => void;
}): Promise<void> {
  if (pending) return;
  setPending(true);
  setError(null);

  const outcome = await retry(id);
  if (outcome.ok) {
    onRetried();
    setPending(false);
    return;
  }

  setError(outcome.message);
  setPending(false);
}

export interface ImportRetry {
  needsReconnect: boolean;
  pending: boolean;
  retryError: string | null;
  onRetry: () => Promise<void>;
}

// Shared failed-import recovery affordance (SPEC §11 M3.5, decision 7A):
// pending guard, dead-PAT branch, and retry error copy in one place, consumed by
// the doc page's ImportFailed state (#83) and the documents-list row (#87) —
// whatever markup each surface wraps around it. What "success" *does* differs per
// surface, so the consumer injects `onRetried`: the doc page refreshes the route
// (re-entering its importing/poll state); the list row flips its own row back to
// `importing` so the RowPoller resumes in place. Keeping the router out of here
// means the row consumer needs no app-router context.
export function useImportRetry({
  id,
  error,
  onRetried,
}: {
  id: number;
  error: string | null;
  onRetried: () => void;
}): ImportRetry {
  const needsReconnect = importNeedsReconnect(error);
  const [pending, setPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const onRetry = () =>
    runImportRetry({
      id,
      pending,
      retry: retryImport,
      setPending,
      setError: setRetryError,
      onRetried,
    });

  return { needsReconnect, pending, retryError, onRetry };
}
