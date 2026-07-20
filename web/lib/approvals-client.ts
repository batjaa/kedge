'use client';

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { Approval } from './document-types';

export type ApprovalMutationOutcome =
  | { ok: true; approval: Approval }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

export type RevokeApprovalOutcome =
  | { ok: true }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

type MutationMethod = 'POST' | 'DELETE';

function send(method: MutationMethod, path: string): Promise<Response> {
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
  });
}

async function mutate(method: MutationMethod, path: string): Promise<Response> {
  await ensureCsrfCookie();
  let res = await send(method, path);
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send(method, path);
  }
  return res;
}

export async function approveDocument(documentId: number): Promise<ApprovalMutationOutcome> {
  const res = await mutate('POST', `/api/v1/documents/${documentId}/approvals`);

  if (res.ok) {
    return { ok: true, approval: (await res.json()) as Approval };
  }

  if (res.status === 422 || res.status === 409) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not approve this version.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not approve this version. Please try again.' };
}

export async function revokeApproval(approvalId: number): Promise<RevokeApprovalOutcome> {
  const res = await mutate('DELETE', `/api/v1/approvals/${approvalId}`);

  if (res.ok) {
    return { ok: true };
  }

  if (res.status === 422 || res.status === 409) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not revoke this approval.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not revoke this approval. Please try again.' };
}
