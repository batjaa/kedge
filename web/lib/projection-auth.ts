import { createHash, timingSafeEqual } from 'node:crypto';

// The projection endpoint (app/internal/projection) is internal: only the API's
// import queue job may call it, and it must never be reachable from the public
// internet in the SaaS topology (SPEC §5.4). In the Next app router every route
// is publicly routable, so the guard is a shared secret enforced HERE, at the
// app — never a reverse-proxy rule that a topology change could quietly drop.

const DEV_SECRET = 'dev-projection-secret';
const HEADER = 'x-projection-secret';

export const PROJECTION_SECRET_HEADER = HEADER;

/**
 * The secret the endpoint requires, or `null` when it must be disabled (fail
 * closed). Production MUST set `PROJECTION_SHARED_SECRET`; absent it, the
 * endpoint is disabled outright rather than trusting a guessable default. In dev
 * it falls back to a well-known value the API also defaults to, so `npm run dev`
 * projects out of the box.
 */
export function projectionSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.PROJECTION_SHARED_SECRET;
  if (configured && configured.length > 0) return configured;
  if (env.NODE_ENV === 'production') return null; // fail closed — no default in prod
  return DEV_SECRET;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Constant-time check of the caller-supplied secret against the configured one.
 * Digesting both to a fixed length keeps the compare timing-safe regardless of
 * input length. A disabled endpoint (no secret) rejects every request.
 */
export function isAuthorized(
  provided: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const secret = projectionSecret(env);
  if (secret === null || provided == null) return false;
  return timingSafeEqual(digest(secret), digest(provided));
}
