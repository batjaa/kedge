import { describe, expect, it } from 'vitest';
import {
  approvableSplitIndexes,
  approvedSplitCount,
  canApproveSplit,
  initialSplitApprovals,
  isApprovingAnySplit,
  markSplitApproved,
  markSplitApproving,
  markSplitFailed,
  setSplitApproval,
  resolveSplitAnchor,
  splitIdempotencyKey,
} from '@/lib/ai-split';
import type { SplitProposal, SplitProposalAnchor } from '@/lib/ai-types';

function anchor(overrides: Partial<SplitProposalAnchor> = {}): SplitProposalAnchor {
  return {
    exact: 'The budget section needs a number.',
    prefix: 'Intro prose. ',
    suffix: ' The anchoring rules',
    start: 13,
    end: 47,
    heading_path: ['Doc'],
    projection_version: '2',
    ...overrides,
  };
}

function proposal(overrides: Partial<SplitProposal> = {}): SplitProposal {
  return {
    title: 'Budget number',
    fragment: 'The budget needs a real number.',
    anchor: anchor(),
    ...overrides,
  };
}

describe('split approval state', () => {
  it('starts every proposal idle and approvable', () => {
    const approvals = initialSplitApprovals(3);

    expect(approvals).toHaveLength(3);
    expect(approvals.every((approval) => approval.status === 'idle')).toBe(true);
    expect(approvableSplitIndexes(approvals)).toEqual([0, 1, 2]);
  });

  it('moves one proposal through approving to approved without touching the others', () => {
    let approvals = initialSplitApprovals(3);
    approvals = markSplitApproving(approvals, 1);

    expect(approvals[1].status).toBe('approving');
    expect(isApprovingAnySplit(approvals)).toBe(true);
    expect(approvals[0].status).toBe('idle');

    approvals = markSplitApproved(approvals, 1);

    expect(approvals[1].status).toBe('approved');
    expect(approvedSplitCount(approvals)).toBe(1);
    expect(isApprovingAnySplit(approvals)).toBe(false);
  });

  /**
   * The rule this module exists for: a stale anchor rejected at fork time fails
   * exactly its own proposal, and every other proposal stays approvable.
   */
  it('keeps the remaining proposals approvable when one is rejected', () => {
    let approvals = initialSplitApprovals(3);
    approvals = markSplitApproved(approvals, 0);
    approvals = markSplitFailed(approvals, 1, 'The document changed since this text was selected.');

    expect(approvals[1].status).toBe('failed');
    expect(approvals[1].message).toContain('The document changed');

    // Approved ones are done; the failed one and the untouched one are both
    // still offered — a failure is a retry, not a dead end.
    expect(approvableSplitIndexes(approvals)).toEqual([1, 2]);
    expect(canApproveSplit(approvals[1])).toBe(true);
    expect(canApproveSplit(approvals[0])).toBe(false);
  });

  it('never re-offers an approved proposal to approve-all', () => {
    let approvals = initialSplitApprovals(2);
    approvals = markSplitApproved(approvals, 0);
    approvals = markSplitApproved(approvals, 1);

    expect(approvableSplitIndexes(approvals)).toEqual([]);
    expect(approvedSplitCount(approvals)).toBe(2);
  });

  it('ignores a write past the end of the list rather than throwing', () => {
    const approvals = initialSplitApprovals(1);

    expect(setSplitApproval(approvals, 4, { status: 'approved', message: null })).toEqual(approvals);
    expect(setSplitApproval(approvals, -1, { status: 'approved', message: null })).toEqual(approvals);
  });

  it('treats a missing entry as approvable so a shrunken list never locks up', () => {
    expect(canApproveSplit(undefined)).toBe(true);
  });
});

describe('resolveSplitAnchor', () => {
  it('passes a well-formed proposed anchor through to the fork payload', () => {
    expect(resolveSplitAnchor(proposal())).toEqual({
      kind: 'anchor',
      anchor: {
        exact: 'The budget section needs a number.',
        prefix: 'Intro prose. ',
        suffix: ' The anchoring rules',
        start: 13,
        end: 47,
        heading_path: ['Doc'],
        projection_version: '2',
      },
    });
  });

  it('reads a deliberately absent anchor as an inherit-the-source fork', () => {
    expect(resolveSplitAnchor(proposal({ anchor: null }))).toEqual({ kind: 'none' });
  });

  /**
   * The distinction this type exists for. Collapsing a malformed anchor into
   * "no anchor" would post an anchor-less fork — which SUCCEEDS, silently
   * attaching the new thread to the source thread's selection. The endpoint
   * would have rejected the malformed payload; dropping it on the way there
   * turns that rejection into a quiet wrong answer.
   */
  /**
   * The api always writes the key — null when it proposed no anchor — so a
   * MISSING key is a payload this code did not produce. Reading it as "no
   * anchor" would fork against the source selection on the strength of a shape
   * we do not recognize.
   */
  it('treats a missing anchor field as malformed, not as a deliberate absence', () => {
    const truncated = { title: 'Budget', fragment: 'Fragment.' } as unknown as SplitProposal;

    expect(resolveSplitAnchor(truncated).kind).toBe('invalid');
  });

  it('marks a malformed anchor invalid rather than quietly inheriting', () => {
    for (const broken of [
      anchor({ exact: '' }),
      anchor({ end: 13 }),
      anchor({ start: -1 }),
      anchor({ start: 1.5 }),
      anchor({ projection_version: '' }),
      anchor({ projection_version: undefined as unknown as string }),
      anchor({ start: undefined as unknown as number }),
    ]) {
      expect(resolveSplitAnchor(proposal({ anchor: broken })).kind).toBe('invalid');
    }
  });

  it('repairs only the fields a missing value cannot corrupt', () => {
    const resolved = resolveSplitAnchor(proposal({
      anchor: anchor({
        prefix: undefined as unknown as string,
        heading_path: [1, 'Doc'] as unknown as string[],
      }),
    }));

    expect(resolved).toEqual({
      kind: 'anchor',
      anchor: expect.objectContaining({ prefix: '', heading_path: ['Doc'] }),
    });
  });
});

describe('splitIdempotencyKey', () => {
  it('is stable per run and proposal, so approving twice cannot fork twice', () => {
    expect(splitIdempotencyKey(42, 0)).toBe('ai-split-42-0');
    expect(splitIdempotencyKey(42, 0)).toBe(splitIdempotencyKey(42, 0));
  });

  it('differs across proposals and across runs', () => {
    expect(splitIdempotencyKey(42, 0)).not.toBe(splitIdempotencyKey(42, 1));
    expect(splitIdempotencyKey(42, 0)).not.toBe(splitIdempotencyKey(43, 0));
  });

  it('stays inside the endpoint&apos;s 128-character key limit', () => {
    expect(splitIdempotencyKey(Number.MAX_SAFE_INTEGER, 999).length).toBeLessThanOrEqual(128);
  });
});
