import { describe, it, expect } from 'vitest';
import { isAuthorized, projectionSecret } from '../lib/projection-auth';

// The endpoint's app-level guard (SPEC §5.4): the projection route is internal
// and must reject every request that doesn't carry the shared secret. These
// assert the guard directly, independent of the Next route wrapper.
describe('projection endpoint guard', () => {
  it('accepts the exact configured secret', () => {
    const env = { PROJECTION_SHARED_SECRET: 's3cret' };
    expect(isAuthorized('s3cret', env)).toBe(true);
  });

  it('rejects a wrong secret and a missing header', () => {
    const env = { PROJECTION_SHARED_SECRET: 's3cret' };
    expect(isAuthorized('nope', env)).toBe(false);
    expect(isAuthorized(null, env)).toBe(false);
    expect(isAuthorized(undefined, env)).toBe(false);
  });

  it('falls back to a known dev secret outside production', () => {
    const env = { NODE_ENV: 'development' };
    expect(projectionSecret(env)).toBe('dev-projection-secret');
    expect(isAuthorized('dev-projection-secret', env)).toBe(true);
    expect(isAuthorized(null, env)).toBe(false);
  });

  it('fails closed in production when no secret is configured', () => {
    const env = { NODE_ENV: 'production' };
    expect(projectionSecret(env)).toBeNull();
    expect(isAuthorized('anything', env)).toBe(false);
    expect(isAuthorized('dev-projection-secret', env)).toBe(false);
  });
});
