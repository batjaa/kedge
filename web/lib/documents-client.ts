// Client-side import mutations (SPEC 4, 5.3). Runs in the browser and calls the
// API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum SPA
// mutation pattern as lib/auth-client.ts (the session cookie is httpOnly and
// never read here; only the readable XSRF-TOKEN cookie is echoed back).

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { Document, DocumentListPage, LifecycleStatus } from './document-types';
import type { ValidationErrorBody } from './auth-types';

export type ImportOutcome =
  | { ok: true; document: Document }
  | { ok: false; kind: 'validation'; message: string; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'error'; message: string };

function post(path: string, body?: Record<string, unknown>): Promise<Response> {
  return send('POST', path, body);
}

function patch(path: string, body?: Record<string, unknown>): Promise<Response> {
  return send('PATCH', path, body);
}

function send(method: 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
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
  fallbackError = 'Something went wrong starting the import. Please try again.',
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
    message: fallbackError,
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
  try {
    const res = await fetch(`/api/bff/documents/${encodeURIComponent(String(id))}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    return (await res.json()) as Document;
  } catch {
    // A network blip rejects the fetch; treat it as a transient hiccup (→ null)
    // like DocumentPoller does, so RowPoller keeps its last state and retries next
    // tick rather than the rejection killing the poll chain (row stuck Importing).
    return null;
  }
}

/** GET page N of the workspace document list via the same-origin BFF route (#86). */
export async function readDocumentPage(page: number): Promise<DocumentListPage | null> {
  try {
    const res = await fetch(`/api/bff/documents?page=${encodeURIComponent(String(page))}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    return (await res.json()) as DocumentListPage;
  } catch {
    // Same transient-hiccup semantics: a rejected fetch here would leak an
    // unhandled rejection out of handleLoadMore, so degrade to null and let Load
    // more reappear for another try.
    return null;
  }
}

/** POST /api/v1/documents/{id}/resync — pull the source again. */
export function resyncDocument(id: number): Promise<ImportOutcome> {
  return mutate(
    `/api/v1/documents/${id}/resync`,
    undefined,
    'Something went wrong starting the re-sync. Please try again.',
  );
}

export type DocumentMutationOutcome =
  | { ok: true; document: Document }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

/** PATCH /api/v1/documents/{id} — author-controlled lifecycle state. */
export async function updateDocumentLifecycle(
  id: number,
  lifecycleStatus: LifecycleStatus,
): Promise<DocumentMutationOutcome> {
  await ensureCsrfCookie();
  let res = await patch(`/api/v1/documents/${id}`, { lifecycle_status: lifecycleStatus });

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await patch(`/api/v1/documents/${id}`, { lifecycle_status: lifecycleStatus });
  }

  if (res.ok) {
    return { ok: true, document: (await res.json()) as Document };
  }

  if (res.status === 422 || res.status === 409) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not update the lifecycle.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not update the lifecycle. Please try again.' };
}
