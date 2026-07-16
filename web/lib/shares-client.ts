// Client-side share-link operations (SPEC 10.2). Runs in the browser and calls
// the API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum
// SPA pattern as lib/documents-client.ts. The httpOnly session cookie is never
// read here; only the readable XSRF-TOKEN cookie is echoed back on mutations.

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { CreatedShare, Share, ShareList } from './share-types';

export type CreateShareOutcome =
  | { ok: true; share: CreatedShare }
  | { ok: false; message: string };

export type RevokeShareOutcome = { ok: true; share: Share } | { ok: false; message: string };

function send(
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
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
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  await ensureCsrfCookie();
  let res = await send(method, path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send(method, path, body);
  }

  return res;
}

/** GET the document's shares. A credentialed read — the session cookie rides along. */
export async function listShares(documentId: number): Promise<Share[]> {
  const res = await fetch(`${publicApiBaseUrl}/api/v1/documents/${documentId}/shares`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const body = (await res.json().catch(() => null)) as ShareList | null;
  return body?.data ?? [];
}

/** POST a new share. The response's `url` is the one-time link — surface it now. */
export async function createShare(
  documentId: number,
  expiresInDays: number | null,
): Promise<CreateShareOutcome> {
  const res = await mutate('POST', `/api/v1/documents/${documentId}/shares`, {
    ...(expiresInDays ? { expires_in_days: expiresInDays } : {}),
  });

  if (res.ok) {
    return { ok: true, share: (await res.json()) as CreatedShare };
  }

  if (res.status === 429) {
    return { ok: false, message: 'Too many share links created. Wait a minute, then try again.' };
  }

  return { ok: false, message: 'Could not create the share link. Please try again.' };
}

/** DELETE (revoke) a share. */
export async function revokeShare(
  documentId: number,
  shareId: number,
): Promise<RevokeShareOutcome> {
  const res = await mutate('DELETE', `/api/v1/documents/${documentId}/shares/${shareId}`);

  if (res.ok) {
    return { ok: true, share: (await res.json()) as Share };
  }

  return { ok: false, message: 'Could not revoke the link. Please try again.' };
}
