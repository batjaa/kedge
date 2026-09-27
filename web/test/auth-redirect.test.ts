import { describe, expect, test } from 'vitest';
import { safeAuthNext, verificationPath } from '@/lib/auth-redirect';

describe('post-auth destinations', () => {
  test('preserves a safe app destination including its query string', () => {
    expect(safeAuthNext('/settings?section=profile')).toBe('/settings?section=profile');
    expect(verificationPath('/settings?section=profile')).toBe(
      '/verify-email?next=%2Fsettings%3Fsection%3Dprofile',
    );
  });

  test('normalizes authentication destinations that would bounce back into the gate', () => {
    expect(safeAuthNext('/verify-email?next=%2F')).toBe('/');
    expect(safeAuthNext('/signin')).toBe('/');
    expect(safeAuthNext('/signup?next=%2Fsettings')).toBe('/');
  });
});
