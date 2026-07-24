import type { Project } from './document-types';

// Client-side projects read + the refresh-on-settle wiring for the dashboard
// rail (SPEC §16, M3.7 #104; decision 6A generalized). The rail is seeded
// server-side and kept true in the browser by piggybacking the live list's
// settle/retry/refile/import callbacks — the SAME mechanism that keeps the stats
// strip fresh, so per-project counts never lie after a document moves. No new
// poll loop. Mirrors workspace-summary.ts's BFF read idiom.

interface ProjectCollection {
  data: Project[];
}

/**
 * GET the workspace's projects via the same-origin BFF route. A non-200 or a
 * network blip resolves to null (never throws) so a refresh failure degrades to
 * keeping the last-good rail (see nextProjects) rather than rejecting out of a
 * settle handler or blanking the rail.
 */
export async function readProjects(): Promise<Project[] | null> {
  try {
    const res = await fetch('/api/bff/projects', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const body = (await res.json()) as ProjectCollection;
    return body.data ?? [];
  } catch {
    return null;
  }
}

/**
 * The next rail state after a refresh: a fresh read replaces, a failed one
 * (null) keeps the last-good list. A mid-session refresh hiccup must not blank a
 * rail that was showing real counts — degradation is the *initial* seed failure
 * (threaded separately), not a transient refresh miss.
 */
export function nextProjects(current: Project[], fetched: Project[] | null): Project[] {
  return fetched ?? current;
}
