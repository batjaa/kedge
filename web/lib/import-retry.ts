'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
// pending guard, dead-PAT branch, and retry error copy in one place, consumed
// today by the doc page's ImportFailed state and next by the documents-list row
// (#87) — whatever markup each surface wraps around it.
export function useImportRetry({
  id,
  error,
}: {
  id: number;
  error: string | null;
}): ImportRetry {
  const needsReconnect = importNeedsReconnect(error);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const onRetry = () =>
    runImportRetry({
      id,
      pending,
      retry: retryImport,
      setPending,
      setError: setRetryError,
      onRetried: () => router.refresh(),
    });

  return { needsReconnect, pending, retryError, onRetry };
}
