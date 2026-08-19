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
  splitAnchorPayload,
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

describe('splitAnchorPayload', () => {
  it('passes a well-formed proposed anchor through to the fork payload', () => {
    expect(splitAnchorPayload(proposal())).toEqual({
      exact: 'The budget section needs a number.',
      prefix: 'Intro prose. ',
      suffix: ' The anchoring rules',
      start: 13,
      end: 47,
      heading_path: ['Doc'],
      projection_version: '2',
    });
  });

  it('forks without an anchor when the proposal carries none', () => {
    expect(splitAnchorPayload(proposal({ anchor: null }))).toBeNull();
  });

  /**
   * A half-anchor would be a 422 from the fork endpoint. Degrading to an
   * anchor-less fork keeps the proposal usable instead of unapprovable.
   */
  it('degrades to an anchor-less fork rather than posting a malformed selector', () => {
    expect(splitAnchorPayload(proposal({ anchor: anchor({ exact: '' }) }))).toBeNull();
    expect(splitAnchorPayload(proposal({ anchor: anchor({ end: 13 }) }))).toBeNull();
    expect(
      splitAnchorPayload(proposal({
        anchor: anchor({ projection_version: undefined as unknown as string }),
      })),
    ).toBeNull();
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
