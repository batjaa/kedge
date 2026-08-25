// What the E2E environment's scripted AI answers with (#137).
//
// The api runs under `AI_FAKE_RESPONSES=true` (web/e2e/serve-api.sh), which
// swaps every model call for the deterministic fake in
// api/app/Providers/FakeAiServiceProvider.php. No live model is ever reached, so
// the journeys can assert AI CONTENT rather than settling for "a panel
// appeared" — which is the only way these journeys can fail when generation is
// broken but the surface still renders.
//
// Each constant below mirrors one in that provider. They are duplicated rather
// than shared because the two live in different runtimes; a drift breaks the
// journey that asserts it, loudly and immediately.

/** A digest theme title — proves the digest panel rendered the RUN's output. */
export const FAKE_DIGEST_THEME = 'Anchoring is the moat';

/** Prefix of every scripted improve-the-doc instruction, per thread. */
export const FAKE_IMPROVE_INSTRUCTION_PREFIX = 'Revise the anchored passage so thread';

/** The two titles a scripted split proposal carries. */
export const FAKE_SPLIT_TITLES = ['Anchor survival on re-import', 'The digest stays a draft'] as const;

/**
 * The document text each scripted split proposal anchors to — disjoint spans of
 * `AI_DOC.splitAnchor`, so approving both produces two forked threads with two
 * DIFFERENT anchors.
 */
export const FAKE_SPLIT_QUOTES = [
  'the anchor must survive a re-import',
  'the digest is only ever a draft',
] as const;

/** The scripted thread summary. */
export const FAKE_SUMMARY_CURRENT_STATE =
  'The thread has settled on keeping the anchor, with the wording still open.';

export const FAKE_SUMMARY_OPEN_QUESTION = 'Who writes the worked example?';

/**
 * A reply draft names the stance it was asked for, so a journey that clicks
 * "Push back" and receives an accepting draft fails — the stance actually has
 * to reach the prompt.
 */
export function fakeReplyDraft(stance: 'accept' | 'push back' | 'clarify'): string {
  return `Drafted reply (${stance}): I have read the thread and this is where I land.`;
}

/** The scripted answer to a first question. */
export const FAKE_ASK_ANSWER =
  'The document says the anchor is re-resolved against the new version, not recreated.';

/**
 * The scripted answer to a FOLLOW-UP — a question that arrived carrying the
 * conversation so far (#151).
 *
 * Distinct from the first answer because that difference is the only way the
 * ask journey can tell "the follow-up replayed its transcript" from "the
 * follow-up asked a second isolated question". A single fixed answer would
 * render identically either way, so the conversation could stop working and the
 * journey would still pass.
 */
export const FAKE_ASK_FOLLOW_UP_ANSWER =
  'Following on from what you just asked: the document adds that the offsets are recomputed, never copied.';
