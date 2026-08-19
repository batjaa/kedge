// Client-side agent-token operations (SPEC §15, #131). Runs in the browser and
// calls the API directly with credentials + the X-XSRF-TOKEN header — the same
// Sanctum SPA pattern as lib/integrations-client.ts.
//
// Cookies, never a bearer token: the versioned REST API refuses token
// authentication outright, so this client could not use one even if it wanted
// to. Minting is a human act, from a human's session.

import type { AgentToken, AgentTokenList, MintedAgentToken } from './agent-token-types';
import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';

export type MintOutcome =
  | { ok: true; token: MintedAgentToken }
  | { ok: false; message: string };

export type RevokeOutcome = { ok: true } | { ok: false; message: string };

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

/** GET the caller's agent tokens. A credentialed read; never carries a value. */
export async function listAgentTokens(): Promise<AgentToken[]> {
  const res = await fetch(`${publicApiBaseUrl}/api/v1/agent-tokens`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const body = (await res.json().catch(() => null)) as AgentTokenList | null;
  return body?.data ?? [];
}

/** POST a new named token. The value comes back once, here, and never again. */
export async function mintAgentToken(name: string): Promise<MintOutcome> {
  const res = await mutate('POST', '/api/v1/agent-tokens', { name });

  if (res.ok) {
    return { ok: true, token: (await res.json()) as MintedAgentToken };
  }

  if (res.status === 422) {
    return { ok: false, message: 'Give the token a name of 80 characters or fewer.' };
  }

  if (res.status === 429) {
    return { ok: false, message: 'Too many attempts. Wait a minute, then try again.' };
  }

  return { ok: false, message: 'Could not create the token. Please try again.' };
}

/** DELETE (revoke) a token. The agent's next call fails immediately. */
export async function revokeAgentToken(id: number): Promise<RevokeOutcome> {
  const res = await mutate('DELETE', `/api/v1/agent-tokens/${id}`);

  if (res.ok) return { ok: true };

  return { ok: false, message: 'Could not revoke the token. Please try again.' };
}
