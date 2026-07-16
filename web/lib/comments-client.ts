'use client';

import { publicApiBaseUrl } from './config';
import type { ReviewThread, ThreadAnchorPayload, ThreadComment, ThreadPage } from './thread-types';

export type CreateThreadInput =
  | {
      type: 'inline';
      body: string;
      anchor: ThreadAnchorPayload;
      idempotency_key?: string;
    }
  | {
      type: 'document';
      body: string;
      failed_capture?: boolean;
      idempotency_key?: string;
    };

export type CreateThreadOutcome =
  | { ok: true; thread: ReviewThread }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

export type ReplyOutcome =
  | { ok: true; comment: ThreadComment }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function csrf(): Promise<void> {
  await fetch(`${publicApiBaseUrl}/sanctum/csrf-cookie`, {
    method: 'GET',
    credentials: 'include',
  });
}

function send(method: 'POST', path: string, body: Record<string, unknown>): Promise<Response> {
  const token = readCookie('XSRF-TOKEN');
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { 'X-XSRF-TOKEN': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function mutate(path: string, body: Record<string, unknown>): Promise<Response> {
  await csrf();
  let res = await send('POST', path, body);
  if (res.status === 419) {
    await csrf();
    res = await send('POST', path, body);
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
  const res = await mutate(`/api/v1/documents/${documentId}/threads`, input);

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
  const res = await mutate(`/api/v1/threads/${threadId}/comments`, {
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
