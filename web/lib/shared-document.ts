import { apiBaseUrl } from './config';
import type { SharedDocument, ShareGoneReason } from './share-types';

// Server-only reader for the public share surface (SPEC 10.2). Unlike the BFF
// document read, this carries no cookies — the token in the path is the whole
// capability. Never cached: a revoked or expired link must go dark immediately.

export type SharedReadResult =
  | { kind: 'ok'; document: SharedDocument }
  | { kind: 'gone'; reason: ShareGoneReason }
  | { kind: 'error' };

export async function getSharedDocument(token: string, incoming?: Headers): Promise<SharedReadResult> {
  const requestHeaders: HeadersInit = {
    accept: 'application/json',
    ...forwardedSessionHeaders(incoming),
  };

  try {
    const res = await fetch(
      `${apiBaseUrl}/api/v1/shared/${encodeURIComponent(token)}`,
      { headers: requestHeaders, cache: 'no-store' },
    );

    if (res.status === 200) {
      return { kind: 'ok', document: (await res.json()) as SharedDocument };
    }

    // 410 Gone — revoked, expired, or never-issued, all distinguishable by reason
    // yet all landing on the same friendly page.
    if (res.status === 410) {
      const body = (await res.json().catch(() => null)) as { reason?: ShareGoneReason } | null;
      return { kind: 'gone', reason: body?.reason ?? 'unknown' };
    }

    return { kind: 'error' };
  } catch {
    // API unreachable — surface as a soft error, never a raw crash.
    return { kind: 'error' };
  }
}

function forwardedSessionHeaders(incoming?: Headers): Record<string, string> {
  if (!incoming) return {};

  const cookie = incoming.get('cookie') ?? '';
  if (!cookie.includes('=')) return {};

  return {
    cookie,
    ...statefulOriginHeaders(incoming),
  };
}

function statefulOriginHeaders(incoming: Headers): Record<string, string> {
  const host = incoming.get('x-forwarded-host') ?? incoming.get('host');
  if (!host) return {};

  const proto = incoming.get('x-forwarded-proto') ?? 'http';
  const origin = `${proto}://${host}`;

  return { origin, referer: `${origin}/` };
}
