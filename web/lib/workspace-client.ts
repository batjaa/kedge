// Client-side workspace settings mutations (SPEC §16, M3.7 decision 11A). Runs in
// the browser and calls the API directly with credentials + the X-XSRF-TOKEN
// header — the same Sanctum SPA mutation pattern as projects-client.ts. The
// endpoint is scoped to the caller's own personal workspace (no id in the URL),
// so there is nothing to address but your own.

import { csrfSend } from './csrf-client';
import type { ValidationErrorBody, Workspace } from './auth-types';

export type UpdateWorkspaceOutcome =
  | { ok: true; workspace: Workspace }
  | { ok: false; kind: 'validation'; message: string; errors: Record<string, string[]> }
  | { ok: false; kind: 'rate-limited'; message: string }
  | { ok: false; kind: 'error'; message: string };

/**
 * PATCH /api/v1/workspace — rename the workspace and/or edit its slug. Partial:
 * send only the fields that changed. A slug clash comes back as a 422 with a
 * per-field message the card renders inline (never a raw "validation.unique").
 * The response is the workspace's new `{ id, name, slug }` (no `data` envelope,
 * the settings-surface house shape).
 */
export async function updateWorkspace(
  fields: { name?: string; slug?: string },
): Promise<UpdateWorkspaceOutcome> {
  const res = await csrfSend('/api/v1/workspace', { method: 'PATCH', body: fields });

  if (res.ok) {
    return { ok: true, workspace: (await res.json()) as Workspace };
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as ValidationErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message: data?.message ?? 'Please check the workspace details and try again.',
      errors: data?.errors ?? {},
    };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Could not save your changes. Please try again.' };
}
