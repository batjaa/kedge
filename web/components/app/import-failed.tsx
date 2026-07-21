'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useImportRetry } from '@/lib/import-retry';

// The failed-import state (SPEC 19): shows why it failed and offers a retry CTA.
// Retry re-queues the import on the API, then refreshes so the page re-enters the
// importing/poll state. A token-revoked failure (#23) additionally surfaces a
// reconnect link to Settings — retrying a dead PAT can't help until it is renewed.
// The recovery behaviour (pending guard, dead-PAT branch, retry copy) lives in
// useImportRetry, shared with the documents-list row (SPEC §11 M3.5, decision 7A).
export function ImportFailed({
  id,
  error,
}: {
  id: number;
  error: string | null;
}) {
  // The doc page's success behaviour: refresh the route so it re-enters the
  // importing/poll state (the row consumer flips its own row instead).
  const router = useRouter();
  const { needsReconnect, pending, retryError, onRetry } = useImportRetry({
    id,
    error,
    onRetried: () => router.refresh(),
  });

  return (
    <div className="mt-8 rounded-2xl bg-white p-8 text-center ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <span
        aria-hidden="true"
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-white">
        Import failed
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {error ?? 'The document could not be imported.'}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
        >
          {pending ? 'Retrying…' : 'Retry import'}
        </button>
        {needsReconnect ? (
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
          >
            Reconnect GitHub
          </Link>
        ) : null}
      </div>
      {retryError ? (
        <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
          {retryError}
        </p>
      ) : null}
    </div>
  );
}
