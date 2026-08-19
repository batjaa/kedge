import { cache } from 'react';
import { apiBaseUrl } from './config';
import type { Capabilities } from './auth-types';

// Server-only. Reads the API's public capability surface (GET /api/v1/config)
// to learn which credential-gated features the API has switched on. The single
// source of truth is the API's env — never a duplicated web var — so the web
// app and the API can't disagree about whether, say, GitHub sign-in exists.
//
// Fails closed: if the API is unreachable or the shape is unexpected, every
// capability is treated as OFF and the edition as self-hosted. An unconfigured
// feature therefore hides rather than rendering a button that 404s (the BYO-key
// pattern, SPEC §14); and the public demo surface never shows on an instance we
// can't confirm is the SaaS (#25).
export const FAIL_CLOSED: Capabilities = { github: false, selfHosted: true, ai: false };

/**
 * The payload → capabilities mapping, split out from the fetch so the
 * fail-closed rules are unit-testable without a server (the web's pure-helper
 * test seam).
 */
export function parseCapabilities(payload: unknown): Capabilities {
  if (payload === null || typeof payload !== 'object') return FAIL_CLOSED;

  const data = payload as {
    auth?: { github?: unknown };
    self_hosted?: unknown;
    ai?: { enabled?: unknown };
  };

  // The edition MUST arrive as an explicit boolean. A 200 with a missing or
  // wrongly-typed `self_hosted` (API/web version skew, a proxy mangling the
  // body) is an unexpected shape — fail closed to self-hosted, never default
  // the edition to SaaS. Defaulting to SaaS would leak the public demo landing
  // onto a private instance; the spec requires this read to fail closed to
  // self-hosted (SPEC m3.8 — Marketing landing), which is what this docblock
  // already promises for an unexpected shape.
  if (typeof data.self_hosted !== 'boolean') return FAIL_CLOSED;

  return {
    github: data.auth?.github === true,
    selfHosted: data.self_hosted,
    // `=== true`, never truthiness — and a MISSING `ai` block (a new web against
    // an older api) reads as OFF, which is the BYO-key rule (SPEC §14): the AI
    // surface hides rather than offering a button that 404s.
    ai: data.ai?.enabled === true,
  };
}

export const getCapabilities = cache(async (): Promise<Capabilities> => {
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/config`, {
      headers: { accept: 'application/json' },
      // Capabilities only change on redeploy / env change, so a short cache
      // keeps a shared server IP well under the endpoint's rate limit.
      next: { revalidate: 30 },
    });

    if (!res.ok) return FAIL_CLOSED;

    return parseCapabilities(await res.json());
  } catch {
    return FAIL_CLOSED;
  }
});
