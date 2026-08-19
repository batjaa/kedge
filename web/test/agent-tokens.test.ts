import { describe, expect, it } from 'vitest';
import type { AgentToken, MintedAgentToken } from '@/lib/agent-token-types';
import { lastUsedDescriptor, withMintedToken, withoutToken } from '@/lib/agent-tokens';

// The pure decisions behind the agent-token settings surface (SPEC §15, #131) —
// the web seam is helpers, not the island (spec testing decision 2).

const token = (over: Partial<AgentToken> = {}): AgentToken => ({
  id: 1,
  name: 'Claude Code',
  last_used_at: null,
  created_at: '2026-08-18T09:00:00Z',
  ...over,
});

describe('lastUsedDescriptor', () => {
  it('calls out a token that has never been used', () => {
    expect(lastUsedDescriptor(token())).toEqual({ kind: 'never' });
  });

  it('carries a real date once the agent has worked', () => {
    const descriptor = lastUsedDescriptor(token({ last_used_at: '2026-08-18T10:30:00Z' }));

    expect(descriptor.kind).toBe('at');
    expect(descriptor.kind === 'at' && descriptor.date.toISOString()).toBe(
      '2026-08-18T10:30:00.000Z',
    );
  });

  it('degrades an unparseable timestamp to "never", not "Invalid Date"', () => {
    expect(lastUsedDescriptor(token({ last_used_at: 'not-a-date' }))).toEqual({
      kind: 'never',
    });
  });
});

describe('withoutToken', () => {
  it('removes the revoked row outright — revocation deletes the credential', () => {
    const list = [token({ id: 1 }), token({ id: 2, name: 'Codex' })];

    expect(withoutToken(list, 1)).toEqual([token({ id: 2, name: 'Codex' })]);
  });

  it('is a no-op for an id that is not in the list', () => {
    const list = [token({ id: 1 })];

    expect(withoutToken(list, 99)).toEqual(list);
  });
});

describe('withMintedToken', () => {
  const minted: MintedAgentToken = {
    id: 7,
    name: 'New agent',
    last_used_at: null,
    created_at: '2026-08-18T11:00:00Z',
    value: '7|super-secret-plaintext',
  };

  it('puts the new token first, matching the server ordering', () => {
    const list = withMintedToken([token({ id: 1 })], minted);

    expect(list.map((t) => t.id)).toEqual([7, 1]);
  });

  it('never carries the one-time value into the persistent list state', () => {
    const [listed] = withMintedToken([], minted);

    expect(Object.keys(listed).sort()).toEqual([
      'created_at',
      'id',
      'last_used_at',
      'name',
    ]);
    expect(JSON.stringify(listed)).not.toContain('super-secret-plaintext');
  });
});
