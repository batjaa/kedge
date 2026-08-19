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

/**
 * The position the AUTHOR picked before the model read anything (M4 #133). There
 * is deliberately no "let the AI decide" stance: choosing what to say is the
 * human's act, and the draft is only the wording.
 */
export type ReplyStance = 'accept' | 'push_back' | 'clarify';

export const REPLY_STANCES: readonly ReplyStance[] = ['accept', 'push_back', 'clarify'];

/**
 * A drafted reply. `body` is editable text destined for the composer — never
 * something the client posts on its own (hard rule 5). Empty when nothing the
 * model could read fit the context budget; `coverage` says so.
 */
export interface ReplyDraftOutput {
  stance: ReplyStance;
  body: string;
  coverage: AiRunCoverage;
}

/** Where a long thread stands, and what it is still waiting on. */
export interface ThreadSummaryOutput {
  current_state: string;
  open_question: string;
  coverage: AiRunCoverage;
}

/** Every artifact an AI run can land. One member per run type. */
export type AiRunOutput =
  | DigestOutput
  | ImprovePromptOutput
  | ReplyDraftOutput
  | ThreadSummaryOutput;

export function isDigestOutput(output: AiRunOutput | null): output is DigestOutput {
  return output !== null && 'themes' in output;
}

export function isImprovePromptOutput(
  output: AiRunOutput | null,
): output is ImprovePromptOutput {
  return output !== null && 'prompt' in output;
}

/**
 * One run of any type. The output shape is the type parameter, because a run's
 * `output` is only meaningful once you know which endpoint you asked — it
 * defaults to the full union, so an un-parameterized `AiRun` narrows through
 * the guards above exactly as before.
 */
export interface AiRun<TOutput = AiRunOutput> {
  id: number;
  document_id: number;
  type: AiRunType;
  /** What was asked for within the type — the reply-draft stance, or null. */
  variant: string | null;
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
