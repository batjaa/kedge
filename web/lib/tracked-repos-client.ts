// Client-side tracked-repo calls (SPEC §16, M3.6). Runs in the browser and POSTs
// to the API directly with credentials + the X-XSRF-TOKEN header — the same
// Sanctum SPA pattern as projects-client.ts / documents-client.ts. `preview` is a
// POST but READ-ONLY; `createTrackedRepo` persists the record and kicks off its
// first scan (202); `readTrackedRepo` is the scan poll target (#93).

import { publicApiBaseUrl } from './config';
import { ensureCsrfCookie, refreshCsrfCookie, xsrfHeader } from './csrf-client';
import type { TrackedRepo } from './tracked-repo-scan';

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

/** The create outcome — the persisted record on success, else a structured failure. */
export type CreateTrackedRepoOutcome =
  | { ok: true; trackedRepo: TrackedRepo }
  | { ok: false; kind: 'not-found' | 'validation' | 'rate-limited' | 'error'; message: string };

interface TrackedRepoEnvelope {
  data: TrackedRepo;
}

function sendCreate(body: PreviewInput): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/tracked-repos`, {
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

/**
 * POST /api/v1/tracked-repos — persist the tracked repo and start its first scan.
 * 202 with the pending record; the panel then polls {@link readTrackedRepo} until
 * the scan settles. A foreign project id 404s (8A).
 */
export async function createTrackedRepo(input: PreviewInput): Promise<CreateTrackedRepoOutcome> {
  await ensureCsrfCookie();
  let res = await sendCreate(input);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await sendCreate(input);
  }

  if (res.ok) {
    const body = (await res.json()) as TrackedRepoEnvelope;
    return { ok: true, trackedRepo: body.data };
  }

  if (res.status === 404) {
    return { ok: false, kind: 'not-found', message: 'That project is no longer available.' };
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as PreviewErrorBody | null;
    return {
      ok: false,
      kind: 'validation',
      message:
        body?.message ??
        firstFieldError(body?.errors) ??
        'Please check the repository details and try again.',
    };
  }

  if (res.status === 429) {
    return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
  }

  return { ok: false, kind: 'error', message: 'Something went wrong starting the scan. Please try again.' };
}

/** A re-scan trigger outcome — the record on success, else an author-facing message. */
export type RescanOutcome =
  | { ok: true; trackedRepo: TrackedRepo }
  | { ok: false; message: string };

function sendScan(id: number): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/tracked-repos/${id}/scan`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', ...xsrfHeader() },
  });
}

/**
 * POST /api/v1/tracked-repos/{id}/scan — re-trigger a scan (#94). Idempotent (the
 * API's atomic claim collapses a double-press onto one scan), 202 with the record.
 * The caller flips the record in-flight so the existing poll takes over until the
 * scan settles. A rate-limit is the only distinct copy; everything else is generic.
 */
export async function rescanTrackedRepo(id: number): Promise<RescanOutcome> {
  await ensureCsrfCookie();
  let res = await sendScan(id);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await sendScan(id);
  }

  if (res.ok) {
    const body = (await res.json()) as TrackedRepoEnvelope;
    return { ok: true, trackedRepo: body.data };
  }

  if (res.status === 429) {
    return { ok: false, message: 'Too many scans. Wait a minute, then try again.' };
  }

  return { ok: false, message: 'Could not start the re-scan. Please try again.' };
}

/**
 * A delete outcome. `conflict` is the 409 a delete hits while a scan is running
 * (7A) — a transient state the caller surfaces distinctly ("wait, then retry"),
 * never a hard failure.
 */
export type DeleteTrackedRepoOutcome =
  | { ok: true }
  | { ok: false; kind: 'conflict' | 'error'; message: string };

function sendDelete(id: number): Promise<Response> {
  return fetch(`${publicApiBaseUrl}/api/v1/tracked-repos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { accept: 'application/json', ...xsrfHeader() },
  });
}

/**
 * DELETE /api/v1/tracked-repos/{id} — un-track the repo (7A); its documents remain
 * (provenance cleared on the API). 204 on success; a 409 while a scan is running is
 * surfaced as a `conflict` with the API's message, so the row can say "a scan is
 * running" rather than a generic error.
 */
export async function deleteTrackedRepo(id: number): Promise<DeleteTrackedRepoOutcome> {
  await ensureCsrfCookie();
  let res = await sendDelete(id);

  if (res.status === 419) {
    await refreshCsrfCookie();
    res = await sendDelete(id);
  }

  if (res.ok) {
    return { ok: true };
  }

  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as PreviewErrorBody | null;
    return {
      ok: false,
      kind: 'conflict',
      message: body?.message ?? 'A scan is running — wait for it to finish, then delete.',
    };
  }

  return { ok: false, kind: 'error', message: 'Could not remove this tracked repo. Please try again.' };
}

/**
 * GET /api/v1/tracked-repos/{id} — the scan poll target. Returns the record on a
 * 200, or null on any hiccup so the poll loop stays alive (the document-poller
 * convention). The caller's {@link scanSettled} decides when to stop.
 */
export async function readTrackedRepo(id: number): Promise<TrackedRepo | null> {
  try {
    const res = await fetch(`${publicApiBaseUrl}/api/v1/tracked-repos/${id}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const body = (await res.json()) as TrackedRepoEnvelope;
    return body.data;
  } catch {
    return null;
  }
}
