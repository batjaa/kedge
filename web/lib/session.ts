import { cache } from 'react';
import { headers } from 'next/headers';
import { forwardMe } from './bff';
import type { Session } from './auth-types';

// Server-only. Reads the current session by forwarding the incoming request's
// cookies to the API (the BFF read path). `cache()` dedupes it per request, so
// the shell layout's guard and the page's content share a single /api/v1/me
// call. Do NOT import this from a Client Component — it relies on next/headers.
export const getSession = cache(async (): Promise<Session | null> => {
  const { session } = await forwardMe(await headers());
  return session;
});
