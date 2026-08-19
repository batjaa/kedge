import type { SplitProposal, SplitProposalAnchor } from './ai-types';
import type { ThreadAnchorPayload } from './thread-types';

/**
 * Pure state for the split-proposal review list (SPEC §14 user story 6, M4
 * #134). Kept out of the component so the one rule that matters here is
 * unit-tested without a DOM: **one proposal's rejection never blocks the
 * others**.
 *
 * That rule is not a nicety. A proposed anchor is validated at fork time against
 * the live projection, so an edit landing between generation and approval fails
 * exactly the proposals whose text moved. If the approve-all loop stopped at the
 * first failure — or if a failure disabled the list — a single stale anchor
 * would strand a whole review's worth of approved work.
 */

export type SplitApprovalStatus = 'idle' | 'approving' | 'approved' | 'failed';

export interface SplitApproval {
  status: SplitApprovalStatus;
  /** The server's reason, shown against the proposal it belongs to. */
  message: string | null;
}

/** One entry per proposal, positionally aligned with the run's output. */
export type SplitApprovals = readonly SplitApproval[];

const IDLE: SplitApproval = { status: 'idle', message: null };

export function initialSplitApprovals(count: number): SplitApprovals {
  return Array.from({ length: Math.max(0, count) }, () => IDLE);
}

/**
 * Replace one proposal's state. Out-of-range indexes are ignored rather than
 * throwing: a run that settled while the list was open can shrink underneath a
 * pending click, and losing that click is better than losing the panel.
 */
export function setSplitApproval(
  approvals: SplitApprovals,
  index: number,
  approval: SplitApproval,
): SplitApprovals {
  if (index < 0 || index >= approvals.length) return approvals;

  return approvals.map((current, position) => (position === index ? approval : current));
}

export function markSplitApproving(approvals: SplitApprovals, index: number): SplitApprovals {
  return setSplitApproval(approvals, index, { status: 'approving', message: null });
}

export function markSplitApproved(approvals: SplitApprovals, index: number): SplitApprovals {
  return setSplitApproval(approvals, index, { status: 'approved', message: null });
}

export function markSplitFailed(
  approvals: SplitApprovals,
  index: number,
  message: string,
): SplitApprovals {
  return setSplitApproval(approvals, index, { status: 'failed', message });
}

/** Whether this proposal's approve button is live. A failure stays approvable. */
export function canApproveSplit(approval: SplitApproval | undefined): boolean {
  return approval === undefined || approval.status === 'idle' || approval.status === 'failed';
}

/**
 * The proposals an "approve all" pass should attempt, in order. Already-approved
 * ones are skipped (approving twice is idempotent server-side, but re-posting
 * them is pointless), and previously failed ones are retried — the document may
 * have moved back, or the earlier failure may have been transient.
 */
export function approvableSplitIndexes(approvals: SplitApprovals): number[] {
  return approvals.flatMap((approval, index) => (canApproveSplit(approval) ? [index] : []));
}

export function approvedSplitCount(approvals: SplitApprovals): number {
  return approvals.filter((approval) => approval.status === 'approved').length;
}

export function isApprovingAnySplit(approvals: SplitApprovals): boolean {
  return approvals.some((approval) => approval.status === 'approving');
}

/**
 * What a proposal's anchor resolves to before anything is posted.
 *
 * The three cases are deliberately NOT collapsed into "anchor or null". A
 * proposal that carries no anchor is a legitimate inherit-the-source fork; a
 * proposal whose anchor is MALFORMED — an old schema, a truncated payload, a
 * half-written selector — is a different animal, and treating it as the former
 * would silently fork against the wrong text instead of failing. The endpoint
 * would have rejected that payload; dropping the anchor on the way there turns
 * its rejection into a quiet success. So a malformed anchor fails its own
 * proposal, unposted.
 */
export type SplitAnchorResolution =
  | { kind: 'anchor'; anchor: ThreadAnchorPayload }
  | { kind: 'none' }
  | { kind: 'invalid' };

export function resolveSplitAnchor(proposal: SplitProposal): SplitAnchorResolution {
  const anchor: SplitProposalAnchor | null = proposal.anchor ?? null;

  if (anchor === null) return { kind: 'none' };

  if (
    typeof anchor !== 'object'
    || typeof anchor.exact !== 'string'
    || anchor.exact === ''
    || typeof anchor.start !== 'number'
    || typeof anchor.end !== 'number'
    || !Number.isInteger(anchor.start)
    || !Number.isInteger(anchor.end)
    || anchor.start < 0
    || anchor.end <= anchor.start
    || typeof anchor.projection_version !== 'string'
    || anchor.projection_version === ''
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'anchor',
    anchor: {
      exact: anchor.exact,
      prefix: typeof anchor.prefix === 'string' ? anchor.prefix : '',
      suffix: typeof anchor.suffix === 'string' ? anchor.suffix : '',
      start: anchor.start,
      end: anchor.end,
      heading_path: Array.isArray(anchor.heading_path)
        ? anchor.heading_path.filter((entry): entry is string => typeof entry === 'string')
        : [],
      projection_version: anchor.projection_version,
    },
  };
}

/**
 * A stable idempotency key per (run, proposal). Approving the same proposal
 * twice — a double-click, a retried approve-all — returns the thread already
 * created rather than forking again; a NEW run mints new keys, because it is a
 * new set of proposals.
 */
export function splitIdempotencyKey(runId: number, index: number): string {
  return `ai-split-${runId}-${index}`;
}
