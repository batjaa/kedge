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
 * The improve-the-doc prompt (#132): one copyable artifact to paste into a
 * coding agent. `prompt` is rendered server-side — unresolved feedback grouped
 * by section, accepted suggested edits carried verbatim, each thread's anchor
 * quoted — and is empty when the review had nothing unresolved to ask for.
 */
export interface ImprovePromptOutput {
  prompt: string;
  /** Accepted suggested edits the artifact carries verbatim. */
  required_edits: number;
  /** Unresolved threads the artifact speaks for. */
  threads: number;
  coverage: AiRunCoverage;
}

/** Every artifact an AI run can land. One member per run type. */
export type AiRunOutput = DigestOutput | ImprovePromptOutput;

export function isDigestOutput(output: AiRunOutput | null): output is DigestOutput {
  return output !== null && 'themes' in output;
}

export function isImprovePromptOutput(
  output: AiRunOutput | null,
): output is ImprovePromptOutput {
  return output !== null && 'prompt' in output;
}

export interface AiRun {
  id: number;
  document_id: number;
  type: AiRunType;
  status: AiRunStatus;
  model: string | null;
  /** Tokens spent so far — recorded as each model call returns, not at the end. */
  tokens: number | null;
  /** USD spent so far, or null when the model has no published price. */
  cost: number | null;
  output: AiRunOutput | null;
  error: AiRunError | null;
  created_at: string;
  updated_at: string;
}
