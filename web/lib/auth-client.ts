// Client-side auth mutations (SPEC §4). These run in the browser and call the
// API directly, with credentials and the X-XSRF-TOKEN header — the pinned
// pattern for mutations, distinct from the server-side BFF read (lib/session).
// The session cookie is httpOnly and never touched here; only the readable
// XSRF-TOKEN cookie is echoed back as a header, per the Sanctum SPA flow.

import { publicApiBaseUrl } from './config';
import type { Session, ValidationErrorBody } from './auth-types';

export type AuthOutcome =
  | { ok: true; session: Session }
  | { ok: false; kind: 'validation'; message: string; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'error'; message: string };

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** Prime the XSRF-TOKEN + session cookies before a credentialed mutation. */
async function csrf(): Promise<void> {
  await fetch(`${publicApiBaseUrl}/sanctum/csrf-cookie`, {
    method: 'GET',
    credentials: 'include',
  });
}

function post(path: string, body?: Record<string, unknown>): Promise<Response> {
  const token = readCookie('XSRF-TOKEN');
  return fetch(`${publicApiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { 'X-XSRF-TOKEN': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function mutate(
  path: string,
  body: Record<string, unknown>,
): Promise<AuthOutcome> {
  await csrf();
  let res = await post(path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await csrf();
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
      message: data?.message ?? 'Please check the form and try again.',
      errors: data?.errors ?? {},
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      kind: 'rate-limited',
      message: 'Too many attempts. Wait a minute, then try again.',
    };
  }

  return {
    ok: false,
    kind: 'error',
    message: 'Something went wrong reaching the server. Please try again.',
  };
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
    await csrf();
    await post('/logout');
  } catch {
    // swallow — the redirect + server re-check is the source of truth
  }
}
