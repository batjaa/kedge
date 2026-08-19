// Pure helpers behind the agent-token settings surface (SPEC §15, #131). Kept
// out of the component so the interesting decisions are testable without a DOM
// (the web test seam is pure helpers — spec testing decision 2).

import type { AgentToken } from './agent-token-types';

/**
 * What the list should say under a token's name.
 *
 * `never` is the load-bearing case: a token that has never been used is either
 * a misconfigured agent or a forgotten credential, and both are worth noticing —
 * so it gets its own sentence rather than an empty slot. An unparseable
 * timestamp degrades to `never` rather than rendering "Invalid Date".
 */
export type LastUsedDescriptor = { kind: 'never' } | { kind: 'at'; date: Date };

export function lastUsedDescriptor(token: Pick<AgentToken, 'last_used_at'>): LastUsedDescriptor {
  if (!token.last_used_at) return { kind: 'never' };

  const date = new Date(token.last_used_at);
  return Number.isNaN(date.getTime()) ? { kind: 'never' } : { kind: 'at', date };
}

/**
 * The list after a revoke: the row is gone, not greyed out. Revocation deletes
 * the credential outright, so leaving a tombstone would imply a state the server
 * does not have.
 */
export function withoutToken(tokens: AgentToken[], id: number): AgentToken[] {
  return tokens.filter((token) => token.id !== id);
}

/**
 * The list after a mint — newest first, matching the server's ordering.
 *
 * Deliberately a field-by-field projection rather than a spread: the mint
 * response carries the one-time value, and this is the boundary where it stops.
 * The value lives only in the reveal box's own state, so nothing that survives
 * the mint can be re-rendered with it.
 */
export function withMintedToken(tokens: AgentToken[], minted: AgentToken): AgentToken[] {
  const listed: AgentToken = {
    id: minted.id,
    name: minted.name,
    last_used_at: minted.last_used_at,
    created_at: minted.created_at,
  };

  return [listed, ...tokens];
}
