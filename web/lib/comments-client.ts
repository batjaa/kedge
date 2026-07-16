'use client';

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { ReviewThread, ThreadAnchorPayload, ThreadComment, ThreadPage, ThreadStatus } from './thread-types';

export type CreateThreadInput =
  | {
      type: 'inline';
      body: string;
      anchor: ThreadAnchorPayload;
      idempotency_key: string;
    }
  | {
      type: 'document';
      body: string;
      failed_capture?: boolean;
      idempotency_key: string;
    };

export type CreateThreadOutcome =
  | { ok: true; thread: ReviewThread }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

export type ReplyOutcome =
  | { ok: true; comment: ThreadComment }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

export type ThreadMutationOutcome =
  | { ok: true; thread: ReviewThread }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

export type DeleteCommentOutcome =
  | { ok: true }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

type MutationMethod = 'POST' | 'PATCH' | 'DELETE';

function send(method: MutationMethod, path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function mutate(method: MutationMethod, path: string, body?: Record<string, unknown>): Promise<Response> {
  await ensureCsrfCookie();
  let res = await send(method, path, body);
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send(method, path, body);
  }
  return res;
}

export async function listThreads(documentId: number, page = 1): Promise<ThreadPage> {
  const res = await fetch(`${publicApiBaseUrl}/api/v1/documents/${documentId}/threads?page=${page}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    return { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } };
  }

  return (await res.json()) as ThreadPage;
}

export async function createThread(
  documentId: number,
  input: CreateThreadInput,
): Promise<CreateThreadOutcome> {
  const res = await mutate('POST', `/api/v1/documents/${documentId}/threads`, input);

  if (res.ok) {
    return { ok: true, thread: (await res.json()) as ReviewThread };
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: body?.message ?? 'Could not save this comment.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many comments. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not save this comment. Please try again.' };
}

export async function replyToThread(threadId: number, body: string, idempotencyKey: string): Promise<ReplyOutcome> {
  const res = await mutate('POST', `/api/v1/threads/${threadId}/comments`, {
    body,
    idempotency_key: idempotencyKey,
  });

  if (res.ok) {
    return { ok: true, comment: (await res.json()) as ThreadComment };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not save this reply.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many comments. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not save this reply. Please try again.' };
}

export async function updateThreadStatus(
  threadId: number,
  status: ThreadStatus,
): Promise<ThreadMutationOutcome> {
  const res = await mutate('PATCH', `/api/v1/threads/${threadId}`, { status });

  if (res.ok) {
    return { ok: true, thread: (await res.json()) as ReviewThread };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not update this thread.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not update this thread. Please try again.' };
}

export async function forkComment(
  commentId: number,
  idempotencyKey: string,
): Promise<ThreadMutationOutcome> {
  const body: Record<string, unknown> = { idempotency_key: idempotencyKey };

  const res = await mutate('POST', `/api/v1/comments/${commentId}/fork`, body);

  if (res.ok) {
    return { ok: true, thread: (await res.json()) as ReviewThread };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not fork this comment.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not fork this comment. Please try again.' };
}

export async function editComment(commentId: number, body: string): Promise<ReplyOutcome> {
  const res = await mutate('PATCH', `/api/v1/comments/${commentId}`, { body });

  if (res.ok) {
    return { ok: true, comment: (await res.json()) as ThreadComment };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not edit this comment.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not edit this comment. Please try again.' };
}

export async function deleteComment(commentId: number): Promise<DeleteCommentOutcome> {
  const res = await mutate('DELETE', `/api/v1/comments/${commentId}`);

  if (res.ok) {
    return { ok: true };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not delete this comment.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not delete this comment. Please try again.' };
}
