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

export interface AiRun {
  id: number;
  document_id: number;
  type: AiRunType;
  status: AiRunStatus;
  model: string | null;
  output: DigestOutput | null;
  error: AiRunError | null;
  created_at: string;
  updated_at: string;
}
