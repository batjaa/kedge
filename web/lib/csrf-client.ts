import { publicApiBaseUrl } from './config';

const XSRF_COOKIE = 'XSRF-TOKEN';

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function xsrfHeader(): Record<string, string> {
  const token = readCookie(XSRF_COOKIE);
  return token ? { 'X-XSRF-TOKEN': token } : {};
}

export async function ensureCsrfCookie(): Promise<void> {
  if (readCookie(XSRF_COOKIE)) return;
  await refreshCsrfCookie();
}

export async function refreshCsrfCookie(): Promise<void> {
  await fetch(`${publicApiBaseUrl}/sanctum/csrf-cookie`, {
    method: 'GET',
    credentials: 'include',
  });
}

/**
 * The one Sanctum SPA mutation transport (generalized from documents-client's
 * `mutate`, the prior art): ensure the XSRF cookie, send the request with
 * credentials + the echoed X-XSRF-TOKEN header, and — on a 419 (stale/absent
 * token) — refresh once and retry before giving up. Returns the raw Response so
 * each caller keeps its own status → outcome mapping. A JSON `body`, when given,
 * is serialized and sets the content-type; a bodyless call (a POST/DELETE trigger)
 * sends neither.
 */
export async function csrfSend(
  path: string,
  { method = 'POST', body, accept = 'application/json' }: { method?: string; body?: unknown; accept?: string } = {},
): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = { accept, ...xsrfHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';

    return fetch(`${publicApiBaseUrl}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  await ensureCsrfCookie();
  let res = await send();

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send();
  }

  return res;
}
