// Client-side dashboard-summary read + the refresh-on-settle wiring (SPEC §16,
// M3.7; decisions 6A + A1). The strip is seeded server-side and kept true in the
// browser by piggybacking the live list's settle/retry/refile callbacks — there
// is no new poll loop here (6A). Mirrors documents-client.ts's BFF read idiom.

import type { WorkspaceSummary } from './document-types';

/**
 * GET the workspace summary via the same-origin BFF route. A non-200 or a
 * network blip resolves to null (never throws) so a summary outage degrades the
 * strip alone (A1) and never rejects out of a settle handler.
 */
export async function readWorkspaceSummary(): Promise<WorkspaceSummary | null> {
  try {
    const res = await fetch('/api/bff/workspace/summary', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    return (await res.json()) as WorkspaceSummary;
  } catch {
    return null;
  }
}

/**
 * The next strip state after a refresh: a fresh read replaces, a failed one
 * (null) keeps the last-good summary. A mid-session refresh hiccup must not blank
 * a strip that was showing real counts — degradation (A1) is the *initial* null,
 * not a transient one, and a stale-but-present count beats a flicker to nothing.
 */
export function nextSummary(
  current: WorkspaceSummary | null,
  fetched: WorkspaceSummary | null,
): WorkspaceSummary | null {
  return fetched ?? current;
}

/**
 * Wrap a live-list callback so a settle / retry / refile also refreshes the
 * summary (6A). The original runs first (the row state is the source of truth),
 * then the strip re-reads — piggybacking the existing callback, never a second
 * poll loop.
 */
export function alsoRefresh<A extends unknown[]>(
  callback: (...args: A) => void,
  refresh: () => void,
): (...args: A) => void {
  return (...args: A) => {
    callback(...args);
    refresh();
  };
}
