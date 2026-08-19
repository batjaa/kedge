/**
 * AI run wire shapes (SPEC §14, §16, M4). Hand-written mirror of
 * api/app/Http/Resources/V1/AiRunResource.php — keep the two in sync.
 */

export type AiRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AiRunType = 'digest' | 'improve_prompt' | 'reply_draft' | 'split' | 'summary' | 'ask';

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
 * The passage a reader had selected when they asked (M4 #139). A subset of the
 * M2 capture object on purpose: an ask persists no anchor and re-anchors
 * nothing, so the offsets and projection version the capture also carries have
 * nothing to be validated against and are not sent.
 */
export interface AskQuote {
  exact: string;
  heading_path: string[];
}

/**
 * One answer to one question (M4 #139). Rendered in an ephemeral panel and
 * copyable — never persisted as a comment, a thread, or a suggestion, because
 * the api has no endpoint that could.
 */
export interface AskOutput {
  answer: string;
  coverage: AiRunCoverage;
}

/** Every artifact an AI run can land. One member per run type. */
export type AiRunOutput =
  | AskOutput
  | DigestOutput
  | ImprovePromptOutput
  | ReplyDraftOutput
  | SplitOutput
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

/** A run whose output is a comment-split proposal list. */
export type AiSplitRun = AiRun<SplitOutput>;
