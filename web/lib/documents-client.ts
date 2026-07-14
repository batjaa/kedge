// Client-side import mutations (SPEC 4, 5.3). Runs in the browser and calls the
// API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum SPA
// mutation pattern as lib/auth-client.ts (the session cookie is httpOnly and
// never read here; only the readable XSRF-TOKEN cookie is echoed back).

import { publicApiBaseUrl } from './config';
import type { Document } from './document-types';
import type { ValidationErrorBody } from './auth-types';

export type ImportOutcome =
  | { ok: true; document: Document }
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
  body?: Record<string, unknown>,
): Promise<ImportOutcome> {
  await csrf();
  let res = await post(path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await csrf();
    res = await post(path, body);
  }

  if (res.ok) {
    return { ok: true, document: (await res.json()) as Document };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as ValidationErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message: data?.message ?? 'Please check the URL and try again.',
      errors: data?.errors ?? {},
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      kind: 'rate-limited',
      message: 'Too many imports. Wait a minute, then try again.',
    };
  }

  return {
    ok: false,
    kind: 'error',
    message: 'Something went wrong starting the import. Please try again.',
  };
}

/** POST /api/v1/documents — begin importing a document from a URL. */
export function importUrl(url: string): Promise<ImportOutcome> {
  return mutate('/api/v1/documents', { url });
}

/** POST /api/v1/documents/{id}/retry — re-run a failed import. */
export function retryImport(id: number): Promise<ImportOutcome> {
  return mutate(`/api/v1/documents/${id}/retry`);
}
