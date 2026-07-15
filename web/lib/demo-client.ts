// Client-side instant-demo + claim mutations (SPEC §10.3, #25). Runs in the
// browser and calls the API directly with credentials + the X-XSRF-TOKEN header
// — the same Sanctum SPA mutation pattern as lib/documents-client.ts. The demo
// import is unauthenticated, but it still flows through the stateful API, so it
// primes the CSRF cookie first exactly like every other mutation here.

import { publicApiBaseUrl } from './config';
import type { Document } from './document-types';
import type { ValidationErrorBody } from './auth-types';

export type DemoOutcome =
  | { ok: true; shareUrl: string; expiresAt: string | null }
  | { ok: false; kind: 'validation'; message: string }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'disabled' }
  | { ok: false; kind: 'error'; message: string };

export type ClaimOutcome =
  | { ok: true; document: Document }
  | { ok: false; kind: 'forbidden' }
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

async function send(
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  await csrf();
  let res = await post(path, body);
  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await csrf();
    res = await post(path, body);
  }
  return res;
}

interface DemoResponse {
  status: string;
  share_url: string;
  expires_at: string | null;
}

/** POST /api/v1/demo/documents — begin an anonymous demo import from a URL. */
export async function startDemo(url: string): Promise<DemoOutcome> {
  const res = await send('/api/v1/demo/documents', { url });

  if (res.ok) {
    const data = (await res.json()) as DemoResponse;
    return { ok: true, shareUrl: data.share_url, expiresAt: data.expires_at };
  }

  // Self-hosted: the endpoint doesn't exist. The home page shouldn't have shown
  // the paste box at all, but degrade gracefully rather than crash.
  if (res.status === 404) return { ok: false, kind: 'disabled' };

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as ValidationErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message:
        data?.errors?.url?.[0] ??
        data?.message ??
        'Enter a public GitHub file link or a raw document URL.',
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      kind: 'rate-limited',
      message: 'Whoa — too many demos from here. Give it a minute and try again.',
    };
  }

  return {
    ok: false,
    kind: 'error',
    message: 'Something went wrong rendering that. Please try again.',
  };
}

/** POST /api/v1/documents/{id}/claim — move a demo doc into my workspace. */
export async function claimDocument(id: number): Promise<ClaimOutcome> {
  const res = await send(`/api/v1/documents/${id}/claim`);

  if (res.ok) {
    return { ok: true, document: (await res.json()) as Document };
  }

  // Already claimed / not a demo doc — the doc is no longer claimable.
  if (res.status === 403 || res.status === 404) {
    return { ok: false, kind: 'forbidden' };
  }

  return {
    ok: false,
    kind: 'error',
    message: 'Couldn’t claim this document. Please try again.',
  };
}
