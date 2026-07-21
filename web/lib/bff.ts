import { apiBaseUrl } from './config';
import type { Session } from './auth-types';

// Server-side BFF core (SPEC §4). The browser never reads the httpOnly session
// cookie; instead the Next server forwards the incoming request's cookies to
// the API's identity route and reports back whether a session is live. Shared
// by the server-component guard (lib/session.ts) and the /api/bff/me route
// handler, so both the server-render path and the client's revalidation path
// go through one cookie-forwarding implementation.

export interface BffSessionResult {
  status: number;
  session: Session | null;
}

/**
 * Forward the caller's cookies (and a stateful Origin) to GET /api/v1/me.
 *
 * @param incoming headers of the request being served — a Server Component's
 *   `await headers()` or a Route Handler's `request.headers`.
 */
export async function forwardMe(incoming: Headers): Promise<BffSessionResult> {
  const cookie = incoming.get('cookie') ?? '';

  // No cookie at all → definitely unauthenticated; skip the network round-trip.
  if (!cookie.includes('=')) {
    return { status: 401, session: null };
  }

  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/me`, {
      headers: {
        cookie,
        accept: 'application/json',
        ...statefulOriginHeaders(incoming),
      },
      // Auth state must never be cached across requests/users.
      cache: 'no-store',
    });

    if (res.status !== 200) {
      return { status: res.status, session: null };
    }

    return { status: 200, session: (await res.json()) as Session };
  } catch {
    // API unreachable — surface as "no session" so the caller can route to
    // sign-in rather than crash the page with a raw error.
    return { status: 502, session: null };
  }
}

export interface BffJsonResult<T> {
  status: number;
  data: T | null;
}

/**
 * Forward the caller's cookies (and a stateful Origin) to an authenticated API
 * GET, returning the parsed body on allowed JSON statuses. The generalization of {@link forwardMe}
 * for resource reads (e.g. a document poll) — same cookie-forwarding contract,
 * same "no cookie ⇒ 401 without a round-trip" and "unreachable ⇒ 502" handling.
 */
export async function forwardApiGet<T>(
  incoming: Headers,
  path: string,
): Promise<BffJsonResult<T>> {
  return forwardApiGetWithJson<T>(incoming, path);
}

export async function forwardApiGetWithJson<T>(
  incoming: Headers,
  path: string,
  bodyStatuses: readonly number[] = [200],
): Promise<BffJsonResult<T>> {
  const cookie = incoming.get('cookie') ?? '';

  if (!cookie.includes('=')) {
    return { status: 401, data: null };
  }

  try {
    const res = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        cookie,
        accept: 'application/json',
        ...statefulOriginHeaders(incoming),
      },
      cache: 'no-store',
      // Bound every server-to-server GET forward: without this a hung API blocks
      // the whole authenticated render for undici's ~300s default (there is no
      // Suspense over the list), instead of the intended degrade-the-list-area
      // -alone path. The abort lands in the catch → 502 → degraded panel.
      signal: AbortSignal.timeout(5000),
    });

    if (!bodyStatuses.includes(res.status)) {
      return { status: res.status, data: null };
    }

    return { status: res.status, data: (await res.json()) as T };
  } catch {
    return { status: 502, data: null };
  }
}

/**
 * Sanctum only honours the session cookie for requests whose Referer/Origin is
 * a configured stateful domain (EnsureFrontendRequestsAreStateful). A
 * server-side fetch carries neither, so we synthesize them from the incoming
 * host — which equals SANCTUM_STATEFUL_DOMAINS in every supported topology
 * (dev localhost:3000, SaaS app host, self-host single origin).
 */
function statefulOriginHeaders(incoming: Headers): Record<string, string> {
  const host = incoming.get('x-forwarded-host') ?? incoming.get('host');
  if (!host) return {};

  const proto = incoming.get('x-forwarded-proto') ?? 'http';
  const origin = `${proto}://${host}`;
  return { origin, referer: `${origin}/` };
}
