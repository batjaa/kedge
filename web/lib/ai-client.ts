import { publicApiBaseUrl } from './config';
import { csrfSend } from './csrf-client';
import type { AiRun } from './ai-types';

/**
 * The AI run client (SPEC §14, §17, M4). POST to request a generation, then poll
 * the run to a terminal status — the established queued-job + poll idiom the
 * tracked-repo scan panel already uses.
 *
 * Every read maps any hiccup to `null`, which is the poller's "keep going"
 * signal: a single dropped poll must never look like a finished run.
 */

export type StartDigestOutcome =
  | { ok: true; run: AiRun }
  | { ok: false; kind: 'unavailable' | 'forbidden' | 'conflict' | 'rate-limited' | 'error'; message: string };

/**
 * POST /api/v1/documents/{id}/ai/digest — 202 with a new run, or 200 with the
 * run already in flight (server-side dedupe). Both are success: the caller polls
 * whichever run it got back.
 */
export async function startDigest(documentId: number): Promise<StartDigestOutcome> {
  try {
    const res = await csrfSend(`/api/v1/documents/${documentId}/ai/digest`, { method: 'POST' });

    if (res.ok) {
      return { ok: true, run: (await res.json()) as AiRun };
    }

    if (res.status === 404) {
      // The instance has no Anthropic key configured (or lost it): the whole AI
      // surface is absent, so say so rather than offering a retry that can't work.
      return { ok: false, kind: 'unavailable', message: 'AI features are not enabled on this instance.' };
    }

    if (res.status === 403) {
      return { ok: false, kind: 'forbidden', message: 'You do not have access to generate a digest here.' };
    }

    if (res.status === 409) {
      return { ok: false, kind: 'conflict', message: 'This document has no imported version to digest yet.' };
    }

    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
    }

    return { ok: false, kind: 'error', message: 'Something went wrong starting the digest. Please try again.' };
  } catch {
    return { ok: false, kind: 'error', message: 'Something went wrong starting the digest. Please try again.' };
  }
}

/**
 * POST /api/v1/documents/{id}/ai/improve-prompt — the second artifact off the
 * same ledger (#132). Same contract as the digest: 202 with a new run, or 200
 * with the run already in flight; both are success, and the caller polls
 * whichever run it got.
 */
export async function startImprovePrompt(documentId: number): Promise<StartDigestOutcome> {
  try {
    const res = await csrfSend(`/api/v1/documents/${documentId}/ai/improve-prompt`, { method: 'POST' });

    if (res.ok) {
      return { ok: true, run: (await res.json()) as AiRun };
    }

    if (res.status === 404) {
      return { ok: false, kind: 'unavailable', message: 'AI features are not enabled on this instance.' };
    }

    if (res.status === 403) {
      return { ok: false, kind: 'forbidden', message: 'You do not have access to generate a prompt here.' };
    }

    if (res.status === 409) {
      return { ok: false, kind: 'conflict', message: 'This document has no imported version to work from yet.' };
    }

    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
    }

    return { ok: false, kind: 'error', message: 'Something went wrong starting the prompt. Please try again.' };
  } catch {
    return { ok: false, kind: 'error', message: 'Something went wrong starting the prompt. Please try again.' };
  }
}

/** GET /api/v1/ai-runs/{id} — the poll target. */
export async function readAiRun(id: number): Promise<AiRun | null> {
  return readRun(`/api/v1/ai-runs/${id}`);
}

/**
 * GET /api/v1/documents/{id}/ai/digest — the panel's re-attach on mount: a run
 * started before a reload, or finished while the tab was closed, is picked back
 * up instead of being forgotten and re-billed. 204 means none was ever
 * requested.
 */
export async function readLatestDigest(documentId: number): Promise<AiRun | null> {
  return readRun(`/api/v1/documents/${documentId}/ai/digest`);
}

/**
 * GET /api/v1/documents/{id}/ai/improve-prompt — the improve-prompt panel's
 * re-attach on mount. 204 means none was ever requested.
 */
export async function readLatestImprovePrompt(documentId: number): Promise<AiRun | null> {
  return readRun(`/api/v1/documents/${documentId}/ai/improve-prompt`);
}

async function readRun(path: string): Promise<AiRun | null> {
  try {
    const res = await fetch(`${publicApiBaseUrl}${path}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok || res.status === 204) return null;

    return (await res.json()) as AiRun;
  } catch {
    return null;
  }
}
