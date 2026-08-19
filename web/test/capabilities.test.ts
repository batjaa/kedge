import { describe, expect, it } from 'vitest';
import { FAIL_CLOSED, parseCapabilities } from '@/lib/capabilities';

describe('parseCapabilities', () => {
  it('reads the capabilities the api reports', () => {
    expect(
      parseCapabilities({
        auth: { github: true },
        self_hosted: false,
        ai: { enabled: true },
        mcp: { enabled: true },
      }),
    ).toEqual({ github: true, selfHosted: false, ai: true, mcp: true });
  });

  it('reads the mcp gate independently of the ai gate', () => {
    // The M4 gates do not move together: a keyless self-host has no AI surface
    // and still hosts agent reviewers, so the token panel must stay visible.
    const keyless = parseCapabilities({
      self_hosted: true,
      ai: { enabled: false },
      mcp: { enabled: true },
    });
    expect(keyless.ai).toBe(false);
    expect(keyless.mcp).toBe(true);

    const noAgents = parseCapabilities({
      self_hosted: true,
      ai: { enabled: true },
      mcp: { enabled: false },
    });
    expect(noAgents.ai).toBe(true);
    expect(noAgents.mcp).toBe(false);
  });

  it('treats a MISSING mcp block as off — a new web against an api without an MCP endpoint', () => {
    expect(parseCapabilities({ auth: { github: false }, self_hosted: false }).mcp).toBe(false);
  });

  it('treats a non-boolean mcp flag as off', () => {
    expect(parseCapabilities({ self_hosted: false, mcp: { enabled: 'yes' } }).mcp).toBe(false);
    expect(parseCapabilities({ self_hosted: false, mcp: {} }).mcp).toBe(false);
    expect(parseCapabilities({ self_hosted: false, mcp: null }).mcp).toBe(false);
  });

  it('treats a MISSING ai block as off — a new web against an older api', () => {
    expect(parseCapabilities({ auth: { github: false }, self_hosted: false }).ai).toBe(false);
  });

  it('treats a non-boolean ai flag as off', () => {
    expect(parseCapabilities({ self_hosted: false, ai: { enabled: 'yes' } }).ai).toBe(false);
    expect(parseCapabilities({ self_hosted: false, ai: {} }).ai).toBe(false);
    expect(parseCapabilities({ self_hosted: false, ai: null }).ai).toBe(false);
  });

  it('fails closed on an unexpected payload', () => {
    expect(parseCapabilities(null)).toEqual(FAIL_CLOSED);
    expect(parseCapabilities('nope')).toEqual(FAIL_CLOSED);
    // A missing edition is the existing fail-closed trigger; AI and MCP go off
    // with it — an api we cannot read is not one to mint agent credentials for.
    expect(parseCapabilities({ ai: { enabled: true }, mcp: { enabled: true } })).toEqual(
      FAIL_CLOSED,
    );
  });
});
