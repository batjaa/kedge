import { describe, expect, it } from 'vitest';
import { isReanchorAuthorized, reanchorSecret } from '../lib/reanchor-auth';

describe('reanchor endpoint guard', () => {
  it('accepts the reanchor-specific secret when configured', () => {
    const env = { REANCHOR_SHARED_SECRET: 'reanchor-secret', PROJECTION_SHARED_SECRET: 'projection-secret' };
    expect(reanchorSecret(env)).toBe('reanchor-secret');
    expect(isReanchorAuthorized('reanchor-secret', env)).toBe(true);
    expect(isReanchorAuthorized('projection-secret', env)).toBe(false);
  });

  it('falls back to the projection secret when no reanchor secret is configured', () => {
    const env = { PROJECTION_SHARED_SECRET: 'projection-secret' };
    expect(reanchorSecret(env)).toBe('projection-secret');
    expect(isReanchorAuthorized('projection-secret', env)).toBe(true);
  });

  it('fails closed in production when neither secret is configured', () => {
    const env = { NODE_ENV: 'production' };
    expect(reanchorSecret(env)).toBeNull();
    expect(isReanchorAuthorized('dev-projection-secret', env)).toBe(false);
  });
});
