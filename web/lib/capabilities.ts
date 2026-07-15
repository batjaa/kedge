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
const FAIL_CLOSED: Capabilities = { github: false, selfHosted: true };

export const getCapabilities = cache(async (): Promise<Capabilities> => {
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/config`, {
      headers: { accept: 'application/json' },
      // Capabilities only change on redeploy / env change, so a short cache
      // keeps a shared server IP well under the endpoint's rate limit.
      next: { revalidate: 30 },
    });

    if (!res.ok) return FAIL_CLOSED;

    const data = (await res.json()) as {
      auth?: { github?: unknown };
      self_hosted?: unknown;
    };
    return {
      github: data.auth?.github === true,
      selfHosted: data.self_hosted === true,
    };
  } catch {
    return FAIL_CLOSED;
  }
});
