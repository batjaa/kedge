// Client-side project mutations (SPEC §16, M3.6). Runs in the browser and calls
// the API directly with credentials + the X-XSRF-TOKEN header — the same Sanctum
// SPA mutation pattern as documents-client.ts.

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { Document, Project } from './document-types';
import type { ValidationErrorBody } from './auth-types';

export type ProjectOutcome =
  | { ok: true; project: Project }
  | { ok: false; kind: 'validation'; message: string; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'error'; message: string };

interface ProjectEnvelope {
  data: Project;
}

function send(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${publicApiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: JSON.stringify(body),
  });
}

async function mutateProject(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
): Promise<ProjectOutcome> {
  await ensureCsrfCookie();
  let res = await send(method, path, body);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send(method, path, body);
  }

  if (res.ok) {
    const envelope = (await res.json()) as ProjectEnvelope;
    return { ok: true, project: envelope.data };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as ValidationErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message: data?.message ?? 'Please check the project details and try again.',
      errors: data?.errors ?? {},
    };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Something went wrong. Please try again.' };
}

/** POST /api/v1/projects — create a project in the caller's workspace. */
export function createProject(name: string, description?: string): Promise<ProjectOutcome> {
  const body: Record<string, unknown> = { name: name.trim() };
  const trimmed = description?.trim();
  if (trimmed) body.description = trimmed;
  return mutateProject('POST', '/api/v1/projects', body);
}

/** PATCH /api/v1/projects/{id} — rename or re-describe a project. */
export function updateProject(
  id: number,
  fields: { name?: string; description?: string | null },
): Promise<ProjectOutcome> {
  return mutateProject('PATCH', `/api/v1/projects/${id}`, fields);
}

export type AssignProjectOutcome =
  | { ok: true; document: Document }
  | { ok: false; kind: 'not-found'; message: string }
  | { ok: false; kind: 'validation' | 'rate-limited' | 'error'; message: string };

/**
 * PATCH /api/v1/documents/{id} — file a document under a project (or clear it to
 * Unfiled with `null`). A foreign project id 404s (8A): the caller surfaces that
 * as "that project is no longer available" and refreshes its project list.
 */
export async function assignDocumentProject(
  id: number,
  projectId: number | null,
): Promise<AssignProjectOutcome> {
  await ensureCsrfCookie();
  const body = { project_id: projectId };
  let res = await send('PATCH', `/api/v1/documents/${id}`, body);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send('PATCH', `/api/v1/documents/${id}`, body);
  }

  if (res.ok) {
    return { ok: true, document: (await res.json()) as Document };
  }

  if (res.status === 404) {
    return { ok: false, kind: 'not-found', message: 'That project is no longer available.' };
  }

  if (res.status === 422 || res.status === 409) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, kind: 'validation', message: data?.message ?? 'Could not move the document.' };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many updates. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not move the document. Please try again.' };
}
