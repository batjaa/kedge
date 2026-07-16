'use client';

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';

export type MagicLinkRequestOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: 'validation' | 'send-failed' | 'rate-limited' | 'gone' | 'error'; message: string };

async function postVerifyEmail(token: string, email: string): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/shared/${encodeURIComponent(token)}/verify-email`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: JSON.stringify({ email }),
  });
}

export async function requestReviewerMagicLink(token: string, email: string): Promise<MagicLinkRequestOutcome> {
  await ensureCsrfCookie();
  let res = await postVerifyEmail(token, email);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await postVerifyEmail(token, email);
  }

  if (res.status === 202) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: true, message: body?.message ?? 'Check your email for a link to continue reviewing.' };
  }

  if (res.status === 422) {
    return { ok: false, kind: 'validation', message: 'Enter a valid email address.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
  }

  if (res.status === 410) {
    return { ok: false, kind: 'gone', message: 'This share link is no longer active.' };
  }

  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'send-failed', message: body?.message ?? "We couldn't send the email. Try again." };
  }

  return { ok: false, kind: 'error', message: "We couldn't send the email. Try again." };
}
