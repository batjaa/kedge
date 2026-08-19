/**
 * AI run wire shapes (SPEC §14, §16, M4). Hand-written mirror of
 * api/app/Http/Resources/V1/AiRunResource.php — keep the two in sync.
 */

export type AiRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AiRunType = 'digest' | 'improve_prompt' | 'reply_draft' | 'split' | 'summary';

/** Whether retrying could ever help — the alertable half of a failure. */
export type AiFailureKind = 'deterministic' | 'transient';

export interface AiRunError {
  kind: AiFailureKind;
  code: string;
  /** The sentence to show next to the retry action. */
  message: string;
}

export interface DigestEntry {
  title: string;
  summary: string;
}

/**
 * Honest coverage (SPEC §14). `statement` is rendered VERBATIM — the web never
 * re-derives the sentence, so truncation can never be silently prettified away.
 */
export interface AiRunCoverage {
  covered: number;
  total: number;
  chunked: boolean;
  statement: string;
}

export interface DigestOutput {
  themes: DigestEntry[];
  contention_points: DigestEntry[];
  consensus: DigestEntry[];
  action_items: DigestEntry[];
  coverage: AiRunCoverage;
}

/**
 * One anchor a split proposal carries (M4 #134). Shaped exactly like a
 * browser-captured selection — the api computes the offsets from the model's
 * verbatim quote — so it is posted straight to the fork endpoint, which
 * re-validates it against the live projection before persisting anything.
 */
export interface SplitProposalAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  heading_path: string[];
  projection_version: string;
}

/**
 * One proposed thread. `anchor` is null when the model's quote could not be
 * matched to the document (or the source thread is document-level): approving
 * such a proposal forks exactly like a manual fork, inheriting the source
 * thread's anchors.
 */
export interface SplitProposal {
  title: string;
  fragment: string;
  anchor: SplitProposalAnchor | null;
}

export interface SplitOutput {
  proposals: SplitProposal[];
  coverage: AiRunCoverage;
}

/**
 * Generic over its output so each surface names the shape it renders. The
 * default keeps the digest's call sites reading `AiRun`; helpers that only touch
 * lifecycle fields take `AiRun<unknown>` and accept every run type.
 */
export interface AiRun<TOutput = DigestOutput> {
  id: number;
  document_id: number;
  type: AiRunType;
  status: AiRunStatus;
  model: string | null;
  /** Tokens spent so far — recorded as each model call returns, not at the end. */
  tokens: number | null;
  /** USD spent so far, or null when the model has no published price. */
  cost: number | null;
  output: TOutput | null;
  error: AiRunError | null;
  created_at: string;
  updated_at: string;
}

/** A run whose output is a comment-split proposal list. */
export type AiSplitRun = AiRun<SplitOutput>;
