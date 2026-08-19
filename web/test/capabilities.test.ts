import { describe, expect, it } from 'vitest';
import { FAIL_CLOSED, parseCapabilities } from '@/lib/capabilities';

describe('parseCapabilities', () => {
  it('reads the capabilities the api reports', () => {
    expect(
      parseCapabilities({ auth: { github: true }, self_hosted: false, ai: { enabled: true } }),
    ).toEqual({ github: true, selfHosted: false, ai: true });
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
    // A missing edition is the existing fail-closed trigger; AI goes off with it.
    expect(parseCapabilities({ ai: { enabled: true } })).toEqual(FAIL_CLOSED);
  });
});
