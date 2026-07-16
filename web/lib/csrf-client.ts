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
