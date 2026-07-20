// Client-side import mutations (SPEC 4, 5.3). Runs in the browser and calls the
// API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum SPA
// mutation pattern as lib/auth-client.ts (the session cookie is httpOnly and
// never read here; only the readable XSRF-TOKEN cookie is echoed back).

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { Document } from './document-types';
import type { ValidationErrorBody } from './auth-types';

export type ImportOutcome =
  | { ok: true; document: Document }
  | { ok: false; kind: 'validation'; message: string; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'error'; message: string };

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
  body?: Record<string, unknown>,
): Promise<ImportOutcome> {
  await ensureCsrfCookie();
  let res = await post(path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await refreshCsrfCookie();
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
    message: 'Something went wrong starting the request. Please try again.',
  };
}

/** POST /api/v1/documents — begin importing a document from a URL. */
export function importUrl(url: string): Promise<ImportOutcome> {
  return mutate('/api/v1/documents', { url });
}

/** POST /api/v1/documents — begin importing directly pasted content (#22). */
export function importPaste(
  content: string,
  title?: string,
): Promise<ImportOutcome> {
  const body: Record<string, unknown> = { content };
  const trimmedTitle = title?.trim();
  if (trimmedTitle) body.title = trimmedTitle;
  return mutate('/api/v1/documents', body);
}

/** POST /api/v1/documents/{id}/retry — re-run a failed import. */
export function retryImport(id: number): Promise<ImportOutcome> {
  return mutate(`/api/v1/documents/${id}/retry`);
}

/** GET /api/v1/documents/{id} via the same-origin BFF poll route. */
export async function readDocument(id: number): Promise<Document | null> {
  const res = await fetch(`/api/bff/documents/${encodeURIComponent(String(id))}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) return null;

  return (await res.json()) as Document;
}

/** POST /api/v1/documents/{id}/resync — pull the source again. */
export function resyncDocument(id: number): Promise<ImportOutcome> {
  return mutate(`/api/v1/documents/${id}/resync`);
}
