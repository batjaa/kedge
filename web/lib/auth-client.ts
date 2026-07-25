// Client-side auth mutations (SPEC §4). These run in the browser and call the
// API directly, with credentials and the X-XSRF-TOKEN header — the pinned
// pattern for mutations, distinct from the server-side BFF read (lib/session).
// The session cookie is httpOnly and never touched here; only the readable
// XSRF-TOKEN cookie is echoed back as a header, per the Sanctum SPA flow.

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { Session, ValidationErrorBody } from './auth-types';

// Failure messages are API prose when the response body provides one (passed
// through untranslated, SPEC m3.9 scope) and null otherwise — the consuming
// component supplies the localized fallback from its catalog (#124).
export type AuthOutcome =
  | { ok: true; session: Session }
  | { ok: false; kind: 'validation'; message: string | null; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string | null }
  | { ok: false; kind: 'error'; message: string | null };

function post(path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${publicApiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function mutate(
  path: string,
  body: Record<string, unknown>,
): Promise<AuthOutcome> {
  await ensureCsrfCookie();
  let res = await post(path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await post(path, body);
  }

  if (res.ok) {
    return { ok: true, session: (await res.json()) as Session };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as ValidationErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message: data?.message ?? null,
      errors: data?.errors ?? {},
    };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: null };
  }

  return { ok: false, kind: 'error', message: null };
}

export function signIn(email: string, password: string): Promise<AuthOutcome> {
  return mutate('/login', { email, password });
}

export function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthOutcome> {
  return mutate('/register', { name, email, password });
}

/**
 * End the session. Best-effort: whatever the network does, the caller routes to
 * sign-in and the server guard re-checks on the next request, so a failed
 * logout never leaves the user stranded on a dead page.
 */
export async function signOut(): Promise<void> {
  try {
    await ensureCsrfCookie();
    let res = await post('/logout');
    if (res.status === 419) {
      await refreshCsrfCookie();
      res = await post('/logout');
    }
  } catch {
    // swallow — the redirect + server re-check is the source of truth
  }
}
