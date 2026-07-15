// Client-side integration operations (SPEC §16). Runs in the browser and calls
// the API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum
// SPA pattern as lib/shares-client.ts. The token is sent once, on connect, and
// never read back: no response here ever carries it.

import { publicApiBaseUrl } from './config';
import type { Integration, IntegrationList } from './integration-types';

export type ConnectOutcome =
  | { ok: true; integration: Integration }
  | { ok: false; message: string };

export type DisconnectOutcome = { ok: true } | { ok: false; message: string };

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Prime the XSRF-TOKEN + session cookies before a credentialed mutation. */
async function csrf(): Promise<void> {
  await fetch(`${publicApiBaseUrl}/sanctum/csrf-cookie`, {
    method: 'GET',
    credentials: 'include',
  });
}

function send(
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const token = readCookie('XSRF-TOKEN');
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
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
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  await csrf();
  let res = await send(method, path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await csrf();
    res = await send(method, path, body);
  }

  return res;
}

/** GET the workspace's integrations, masked. A credentialed read. */
export async function listIntegrations(): Promise<Integration[]> {
  const res = await fetch(`${publicApiBaseUrl}/api/v1/integrations`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const body = (await res.json().catch(() => null)) as IntegrationList | null;
  return body?.data ?? [];
}

/** POST a new PAT. The token leaves the browser here and is never returned. */
export async function connectIntegration(token: string): Promise<ConnectOutcome> {
  const res = await mutate('POST', '/api/v1/integrations', { token });

  if (res.ok) {
    return { ok: true, integration: (await res.json()) as Integration };
  }

  if (res.status === 422) {
    return { ok: false, message: 'That token looks off. Paste a valid GitHub personal access token.' };
  }

  if (res.status === 429) {
    return { ok: false, message: 'Too many attempts. Wait a minute, then try again.' };
  }

  return { ok: false, message: 'Could not connect the token. Please try again.' };
}

/** DELETE (disconnect) an integration. */
export async function disconnectIntegration(id: number): Promise<DisconnectOutcome> {
  const res = await mutate('DELETE', `/api/v1/integrations/${id}`);

  if (res.ok) return { ok: true };

  return { ok: false, message: 'Could not remove the integration. Please try again.' };
}
