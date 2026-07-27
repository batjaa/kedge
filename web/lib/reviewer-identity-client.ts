'use client';

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import {
  REVIEWER_VERIFICATION_STATUS,
  type VerifyReturnState,
} from './reviewer-verification-status';

// Outcome messages are API prose when the response body provided one (passed
// through untranslated, SPEC m3.9 scope) and null otherwise — the consuming
// component supplies the localized fallback per kind/status from the `shared`
// catalog (M3.9 #124).

export type MagicLinkRequestOutcome =
  | { ok: true; message: string | null }
  | { ok: false; kind: 'validation' | 'send-failed' | 'rate-limited' | 'gone' | 'error'; message: string | null };

export type MagicLinkCompletionOutcome =
  | { ok: true }
  | { ok: false; status: VerifyReturnState; message: string | null }
  | { ok: false; status: 'gone' | 'rate-limited' | 'error'; message: string | null };

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

async function postVerifyCompletion(token: string, completionToken: string): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/shared/${encodeURIComponent(token)}/verify/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: JSON.stringify({ completion_token: completionToken }),
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
    return { ok: true, message: body?.message ?? null };
  }

  if (res.status === 422) {
    return { ok: false, kind: 'validation', message: null };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: null };
  }

  if (res.status === 410) {
    return { ok: false, kind: 'gone', message: null };
  }

  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'send-failed', message: body?.message ?? null };
  }

  return { ok: false, kind: 'error', message: null };
}

export async function completeReviewerMagicLink(
  token: string,
  completionToken: string,
): Promise<MagicLinkCompletionOutcome> {
  await ensureCsrfCookie();
  let res = await postVerifyCompletion(token, completionToken);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await postVerifyCompletion(token, completionToken);
  }

  if (res.status === 200) {
    return { ok: true };
  }

  if (res.status === 410) {
    return { ok: false, status: 'gone', message: null };
  }

  if (res.status === 409 || res.status === 422) {
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
    return {
      ok: false,
      status: verifyReturnState(body?.status),
      message: body?.message ?? null,
    };
  }

  if (res.status === 429) {
    return { ok: false, status: 'rate-limited', message: null };
  }

  return { ok: false, status: 'error', message: null };
}

function verifyReturnState(value: string | undefined): VerifyReturnState {
  return value === REVIEWER_VERIFICATION_STATUS.expired
    || value === REVIEWER_VERIFICATION_STATUS.used
    || value === REVIEWER_VERIFICATION_STATUS.accountRequired
    ? value
    : REVIEWER_VERIFICATION_STATUS.invalid;
}
