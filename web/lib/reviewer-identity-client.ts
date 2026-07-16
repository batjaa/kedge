'use client';

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import {
  REVIEWER_VERIFICATION_STATUS,
  type VerifyReturnState,
} from './reviewer-verification-status';

export type MagicLinkRequestOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: 'validation' | 'send-failed' | 'rate-limited' | 'gone' | 'error'; message: string };

export type MagicLinkCompletionOutcome =
  | { ok: true; message: string }
  | { ok: false; status: VerifyReturnState; message: string }
  | { ok: false; status: 'gone' | 'rate-limited' | 'error'; message: string };

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
    return { ok: true, message: 'Email verified. You can comment on this document now.' };
  }

  if (res.status === 410) {
    return { ok: false, status: 'gone', message: 'This share link is no longer active.' };
  }

  if (res.status === 409 || res.status === 422) {
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
    const status = verifyReturnState(body?.status);
    return {
      ok: false,
      status,
      message: body?.message ?? RETURN_COPY[status],
    };
  }

  if (res.status === 429) {
    return { ok: false, status: 'rate-limited', message: 'Too many verification attempts. Wait a minute, then try again.' };
  }

  return { ok: false, status: 'error', message: "We couldn't verify this link. Try again." };
}

export const RETURN_COPY: Record<VerifyReturnState, string> = {
  [REVIEWER_VERIFICATION_STATUS.expired]: 'That verification link expired. Request a fresh link to continue commenting.',
  [REVIEWER_VERIFICATION_STATUS.used]: 'That verification link was already used. Request a fresh link if this browser is not verified.',
  [REVIEWER_VERIFICATION_STATUS.invalid]: 'That verification link could not be verified. Request a fresh link to continue commenting.',
  [REVIEWER_VERIFICATION_STATUS.accountRequired]: 'This email already has a Kedge account. Sign in to review this document.',
};

function verifyReturnState(value: string | undefined): VerifyReturnState {
  return value === REVIEWER_VERIFICATION_STATUS.expired
    || value === REVIEWER_VERIFICATION_STATUS.used
    || value === REVIEWER_VERIFICATION_STATUS.accountRequired
    ? value
    : REVIEWER_VERIFICATION_STATUS.invalid;
}
