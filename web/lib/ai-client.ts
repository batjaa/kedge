import { publicApiBaseUrl } from './config';
import { csrfSend } from './csrf-client';
import type { AiRun, AiSplitRun, AskQuote, DigestOutput, ImprovePromptOutput, ReplyStance, SplitOutput, ThreadSummaryOutput } from './ai-types';

/**
 * The AI run client (SPEC §14, §17, M4). POST to request a generation, then poll
 * the run to a terminal status — the established queued-job + poll idiom the
 * tracked-repo scan panel already uses.
 *
 * Every read maps any hiccup to `null`, which is the poller's "keep going"
 * signal: a single dropped poll must never look like a finished run.
 */

export type StartRunFailure = {
  ok: false;
  kind: 'unavailable' | 'forbidden' | 'conflict' | 'rate-limited' | 'error';
  message: string;
};

export type StartDigestOutcome = { ok: true; run: AiRun } | StartRunFailure;

export type StartSplitOutcome = { ok: true; run: AiSplitRun } | StartRunFailure;

/**
 * The same outcome for a run of any type: the caller knows which output shape it
 * asked for and narrows the run itself.
 */
export type StartAiRunOutcome =
  | { ok: true; run: AiRun<unknown> }
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

/**
 * POST /api/v1/threads/{id}/ai/reply-draft — draft a reply in the author's
 * chosen stance (M4 #133). 202 with a new run, or 200 with the run already in
 * flight FOR THAT STANCE; both are success, and the caller polls whichever it got.
 *
 * The draft comes back as text. Posting it stays the author's own submit through
 * the ordinary reply endpoint — nothing here writes review data (hard rule 5).
 */
export async function startReplyDraft(threadId: number, stance: ReplyStance): Promise<StartAiRunOutcome> {
  return startRun(`/api/v1/threads/${threadId}/ai/reply-draft`, {
    unavailable: 'AI features are not enabled on this instance.',
    forbidden: 'You do not have access to draft a reply here.',
    conflict: 'This document has no imported version to read yet.',
    error: 'Something went wrong drafting a reply. Please try again.',
  }, { stance });
}

/** POST /api/v1/threads/{id}/ai/summary — summarize a long thread. */
export async function startThreadSummary(threadId: number): Promise<StartAiRunOutcome> {
  return startRun(`/api/v1/threads/${threadId}/ai/summary`, {
    unavailable: 'AI features are not enabled on this instance.',
    forbidden: 'You do not have access to summarize this thread.',
    conflict: 'This document has no imported version to read yet.',
    error: 'Something went wrong summarizing this thread. Please try again.',
  });
}

/**
 * GET /api/v1/threads/{id}/ai/summary — the summary panel's re-attach on mount,
 * so re-opening a thread someone already summarized costs nothing. 204 (mapped to
 * null) means none was ever requested.
 */
export async function readLatestThreadSummary(threadId: number): Promise<AiRun<ThreadSummaryOutput> | null> {
  return readRun(`/api/v1/threads/${threadId}/ai/summary`);
}

/**
 * POST /api/v1/comments/{id}/ai/split — propose how one sprawling comment
 * divides into separate threads. 202 with a new run, or 200 with the run already
 * in flight FOR THIS COMMENT (server-side dedupe is per comment, not per
 * document). Both are success: the caller polls whichever run it got back.
 *
 * Nothing is written by this call or by the run it starts. Each proposal becomes
 * a thread only when the author approves it and the client forks (hard rule 5).
 */
export async function startCommentSplit(
  commentId: number,
  documentVersionId: number,
): Promise<StartSplitOutcome> {
  try {
    // The version the reader's page is showing. The server refuses the request
    // when it is no longer current, so a stale page can never be handed anchors
    // into passages it is not displaying.
    const res = await csrfSend(`/api/v1/comments/${commentId}/ai/split`, {
      method: 'POST',
      body: { document_version_id: documentVersionId },
    });

    if (res.ok) {
      return { ok: true, run: (await res.json()) as AiSplitRun };
    }

    if (res.status === 404) {
      return { ok: false, kind: 'unavailable', message: 'AI features are not enabled on this instance.' };
    }

    if (res.status === 403) {
      return { ok: false, kind: 'forbidden', message: 'You do not have access to split comments here.' };
    }

    if (res.status === 409) {
      // The comment cannot be forked, so it cannot be split: a deleted comment,
      // a thread's opening comment, or a document with no current version.
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, kind: 'conflict', message: data?.message ?? 'This comment cannot be split.' };
    }

    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
    }

    return { ok: false, kind: 'error', message: 'Something went wrong proposing a split. Please try again.' };
  } catch {
    return { ok: false, kind: 'error', message: 'Something went wrong proposing a split. Please try again.' };
  }
}

/**
 * POST /api/v1/documents/{id}/ai/ask — ask a free-form question about the
 * document, optionally about one selected passage (M4 #139).
 *
 * ALWAYS 202 with a new run. This is the one generation endpoint with no
 * dedupe: two questions about one document are two different questions, so
 * there is no in-flight run to be handed instead of an answer to your own.
 *
 * There is deliberately no `readLatestAsk`. The answer lives in the panel and
 * nowhere else — closing it is how you throw it away — so nothing here can go
 * back and fetch one.
 */
export async function startAsk(
  documentId: number,
  question: string,
  quote?: AskQuote | null,
): Promise<StartAiRunOutcome> {
  return startRun(
    `/api/v1/documents/${documentId}/ai/ask`,
    {
      unavailable: 'AI features are not enabled on this instance.',
      forbidden: 'You do not have access to ask about this document.',
      conflict: 'This document has no imported version to read yet.',
      error: 'Something went wrong asking that. Please try again.',
    },
    quote ? { question, quote } : { question },
  );
}

/** GET /api/v1/ai-runs/{id} — the poll target. */
export async function readAiRun<TOutput = DigestOutput>(id: number): Promise<AiRun<TOutput> | null> {
  return readRun(`/api/v1/ai-runs/${id}`);
}

/** GET /api/v1/ai-runs/{id} — the poll target, typed as a split run. */
export async function readAiSplitRun(id: number): Promise<AiSplitRun | null> {
  return readRun<SplitOutput>(`/api/v1/ai-runs/${id}`);
}

/**
 * The re-attach read's three answers. "No run" and "could not read" must not be
 * the same value here: the panel treats "no run" as licence to start a NEW one,
 * and a dropped read reported as "no run" bills the key for a second run whose
 * answer already existed.
 */
export type LatestSplitOutcome =
  | { kind: 'run'; run: AiSplitRun }
  | { kind: 'none' }
  | { kind: 'unavailable' };

/**
 * GET /api/v1/comments/{id}/ai/split — the split panel's re-attach when it
 * opens. 204 means no split was ever requested for this comment.
 */
export async function readLatestCommentSplit(commentId: number): Promise<LatestSplitOutcome> {
  try {
    const res = await fetch(`${publicApiBaseUrl}/api/v1/comments/${commentId}/ai/split`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (res.status === 204) return { kind: 'none' };
    if (!res.ok) return { kind: 'unavailable' };

    return { kind: 'run', run: (await res.json()) as AiSplitRun };
  } catch {
    return { kind: 'unavailable' };
  }
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
export async function readLatestImprovePrompt(
  documentId: number,
): Promise<AiRun<ImprovePromptOutput> | null> {
  return readRun(`/api/v1/documents/${documentId}/ai/improve-prompt`);
}

async function readRun<TOutput = DigestOutput>(path: string): Promise<AiRun<TOutput> | null> {
  try {
    const res = await fetch(`${publicApiBaseUrl}${path}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok || res.status === 204) return null;

    return (await res.json()) as AiRun<TOutput>;
  } catch {
    return null;
  }
}

/**
 * The shared POST → run shape for the M4 run types (#133). Each caller supplies
 * its own sentences, because "you cannot do that here" reads differently for a
 * digest and for a reply draft — the status → outcome mapping is what is shared.
 *
 * A 202 and a 200 are both success: the server deduped the second one back onto
 * the run already in flight, and the caller polls whichever run it received.
 */
async function startRun(
  path: string,
  messages: { unavailable: string; forbidden: string; conflict: string; error: string },
  body?: Record<string, unknown>,
): Promise<StartAiRunOutcome> {
  try {
    const res = await csrfSend(path, { method: 'POST', body });

    if (res.ok) {
      return { ok: true, run: (await res.json()) as AiRun<unknown> };
    }

    // 404: the instance has no Anthropic key configured (or lost it), so the
    // whole AI surface is absent — say so rather than offering a doomed retry.
    if (res.status === 404) return { ok: false, kind: 'unavailable', message: messages.unavailable };
    if (res.status === 403) return { ok: false, kind: 'forbidden', message: messages.forbidden };
    if (res.status === 409) return { ok: false, kind: 'conflict', message: messages.conflict };
    if (res.status === 429) {
      return { ok: false, kind: 'rate-limited', message: 'Too many requests. Wait a minute, then try again.' };
    }

    return { ok: false, kind: 'error', message: messages.error };
  } catch {
    return { ok: false, kind: 'error', message: messages.error };
  }
}
