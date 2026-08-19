import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAgentTokens, mintAgentToken } from '@/lib/agent-tokens-client';

// A revocation surface must never dress a failure up as "nothing to revoke"
// (found by the #131 codex gate). These pin the two ambiguous outcomes: a list
// that did not load, and a mint whose one-time value did not arrive.

describe('listAgentTokens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports failure rather than an empty list when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    await expect(listAgentTokens()).resolves.toEqual({ ok: false });
  });

  it('reports failure when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));

    await expect(listAgentTokens()).resolves.toEqual({ ok: false });
  });

  it('reports failure on a malformed body rather than inventing an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response),
    );

    await expect(listAgentTokens()).resolves.toEqual({ ok: false });
  });

  it('is an empty list only when the API actually says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as unknown as Response),
    );

    await expect(listAgentTokens()).resolves.toEqual({ ok: true, tokens: [] });
  });
});

describe('mintAgentToken', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the API validation message rather than guessing at 422', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          errors: { name: ['You already have 50 agent tokens. Revoke one before creating another.'] },
        }),
      } as unknown as Response),
    );

    const outcome = await mintAgentToken('Claude Code');

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain('already have 50');
  });

  it('falls back to the name hint when the API sends no message', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({}),
      } as unknown as Response),
    );

    const outcome = await mintAgentToken('Claude Code');

    expect(outcome.ok === false && outcome.message).toContain('80 characters');
  });

  it('tells the operator to revoke when the token landed but its value did not', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 1, name: 'Claude Code', last_used_at: null, created_at: null }),
      } as unknown as Response),
    );

    const outcome = await mintAgentToken('Claude Code');

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain('revoke it');
  });
});
