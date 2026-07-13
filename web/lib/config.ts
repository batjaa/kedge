// API base URL knobs (SPEC §4 auth handshake). Every deployment topology —
// dev two-port, SaaS split-domain, self-host single-origin — is expressed as
// env changes here, never a code change. See web/.env.example for worked values.
//
// Two variants, because the web app reaches the API from two places:
//
//   API_URL              server-side only (BFF route handlers + server
//                        components forwarding cookies). Never shipped to the
//                        browser, so it may point at an internal address.
//   NEXT_PUBLIC_API_URL  inlined into client bundles. Used by client
//                        components that call the API directly (the auth
//                        mutations: csrf-cookie, register, login, logout).
//
// Both default to the dev API on :8000. Set them to '' (empty) for the
// same-origin topology: URLs collapse to relative paths ('/login',
// '/api/v1/me', …) served by one reverse proxy in front of both apps.

const DEV_API_URL = 'http://localhost:8000';

/** Server-side API base. Trailing slash trimmed so `${apiBaseUrl}/path` is clean. */
export const apiBaseUrl = trimTrailingSlash(process.env.API_URL ?? DEV_API_URL);

/** Client-visible API base (inlined at build time). */
export const publicApiBaseUrl = trimTrailingSlash(
  process.env.NEXT_PUBLIC_API_URL ?? DEV_API_URL,
);

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
