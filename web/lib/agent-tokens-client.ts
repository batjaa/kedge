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

export type ListOutcome =
  | { ok: true; tokens: AgentToken[] }
  | { ok: false };

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

/**
 * GET the caller's agent tokens. A credentialed read; never carries a value.
 *
 * A failure is reported as a failure, never as an empty list: "you have no
 * agent tokens" and "we could not reach the API" must not look the same on a
 * revocation surface — an operator cutting off an agent has to be able to tell
 * that they are looking at the real list.
 */
export async function listAgentTokens(): Promise<ListOutcome> {
  try {
    const res = await fetch(`${publicApiBaseUrl}/api/v1/agent-tokens`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return { ok: false };

    const body = (await res.json().catch(() => null)) as AgentTokenList | null;
    if (!body || !Array.isArray(body.data)) return { ok: false };

    return { ok: true, tokens: body.data };
  } catch {
    return { ok: false };
  }
}

/**
 * POST a new named token. The value comes back once, here, and never again —
 * which is why an unreadable success body is reported as an error the operator
 * must act on: a token may exist that nobody can use, and it should be revoked.
 */
export async function mintAgentToken(name: string): Promise<MintOutcome> {
  let res: Response;
  try {
    res = await mutate('POST', '/api/v1/agent-tokens', { name });
  } catch {
    return { ok: false, message: 'Could not reach the API. Reload the list before trying again.' };
  }

  if (res.ok) {
    const token = (await res.json().catch(() => null)) as MintedAgentToken | null;

    if (!token || typeof token.value !== 'string') {
      return {
        ok: false,
        message:
          'The token was created but its value did not arrive. Reload the list and revoke it.',
      };
    }

    return { ok: true, token };
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
  let res: Response;
  try {
    res = await mutate('DELETE', `/api/v1/agent-tokens/${id}`);
  } catch {
    return { ok: false, message: 'Could not reach the API. Please try again.' };
  }

  if (res.ok) return { ok: true };

  return { ok: false, message: 'Could not revoke the token. Please try again.' };
}
