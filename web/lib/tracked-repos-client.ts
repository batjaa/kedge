// Client-side tracked-repo preview (SPEC §16, M3.6). Runs in the browser and
// POSTs to the API directly with credentials + the X-XSRF-TOKEN header — the same
// Sanctum SPA pattern as projects-client.ts / documents-client.ts. Preview is a
// POST but READ-ONLY (no persistence): it lists exactly which files a scan would
// import. Nothing here imports — the confirm/scan wiring arrives with #93.

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';

/** One file a scan would import, flagged if another tracked repo already holds it (10A). */
export interface PreviewFile {
  path: string;
  overlap: boolean;
}

/** A successful preview body (mirrors TrackedRepoPreview::toArray on the API). */
export interface PreviewMatches {
  ref: string;
  cap: number;
  count: number;
  overlap_count: number;
  files: PreviewFile[];
}

export interface PreviewInput {
  repo_url: string;
  ref?: string;
  path_pattern: string;
  project_id?: number;
}

/**
 * The preview outcome. `over_cap` / `truncated` are the two loud, structured
 * failures the panel renders distinctly (story 18 / 4A); every other upstream or
 * input failure collapses to `error` carrying the API's author-facing message.
 */
export type PreviewOutcome =
  | { ok: true; preview: PreviewMatches }
  | { ok: false; kind: 'over_cap'; count: number; cap: number; message: string }
  | { ok: false; kind: 'truncated'; message: string }
  | { ok: false; kind: 'error'; message: string };

interface PreviewErrorBody {
  error?: string;
  message?: string;
  count?: number;
  cap?: number;
  errors?: Record<string, string[]>;
}

function send(body: PreviewInput): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/tracked-repos/preview`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...xsrfHeader(),
    },
    body: JSON.stringify(body),
  });
}

/** POST /api/v1/tracked-repos/preview — list matching files, read-only. */
export async function previewTrackedRepo(input: PreviewInput): Promise<PreviewOutcome> {
  await ensureCsrfCookie();
  let res = await send(input);

  // 419 = stale/absent CSRF token. Refresh once and retry before giving up.
  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await send(input);
  }

  if (res.ok) {
    return { ok: true, preview: (await res.json()) as PreviewMatches };
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as PreviewErrorBody | null;

    if (body?.error === 'over_cap') {
      return {
        ok: false,
        kind: 'over_cap',
        count: body.count ?? 0,
        cap: body.cap ?? 0,
        message: body.message ?? 'Too many files match. Narrow the pattern before importing.',
      };
    }

    if (body?.error === 'truncated') {
      return {
        ok: false,
        kind: 'truncated',
        message: body.message ?? 'This repository is too large for GitHub to list in full.',
      };
    }

    // A preview error (invalid_ref, unsupported_repo, unreachable, …) or a plain
    // field-validation body — both carry an author-facing message.
    return {
      ok: false,
      kind: 'error',
      message:
        body?.message ??
        firstFieldError(body?.errors) ??
        'Please check the repository details and try again.',
    };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'error', message: 'Too many previews. Wait a minute, then try again.' };
  }

  if (res.status === 404) {
    return { ok: false, kind: 'error', message: 'That project is no longer available.' };
  }

  return { ok: false, kind: 'error', message: 'Something went wrong. Please try again.' };
}

function firstFieldError(errors?: Record<string, string[]>): string | undefined {
  if (!errors) return undefined;
  for (const messages of Object.values(errors)) {
    if (messages.length > 0) return messages[0];
  }
  return undefined;
}
