<?php

namespace App\Enums;

/**
 * What one AI run generates (SPEC §14, §16). The full M4 vocabulary lands with
 * the ledger so the column's domain is stable from the first migration; the
 * digest tracer bullet is the first type wired end to end, and each later
 * feature registers its builder against the case already reserved here.
 *
 * Because the backing VALUES are persisted in `ai_runs.type` and read by the
 * cost ledger, add cases — never re-spell one.
 */
enum AiRunType: string
{
    case Digest = 'digest';
    case ImprovePrompt = 'improve_prompt';
    case ReplyDraft = 'reply_draft';
    case Split = 'split';
    case Summary = 'summary';
    case Ask = 'ask';

    /**
     * The model this run type is billed against (SPEC §14, spec "Packages and
     * gating"): the default model everywhere, except thread summaries — a
     * high-volume, low-stakes op that runs on the cheap model.
     *
     * ONE rule, read by both sides of a run: the ledger stamps it at mint time
     * so an in-flight row already says what it will cost against, and each
     * agent resolves the same call so the row and the request can never name
     * different models. Both are env-overridable (`AI_MODEL`,
     * `AI_SUMMARY_MODEL`) and resolved at call time, so an operator retunes
     * either one without a deploy.
     */
    public function model(): string
    {
        return $this === self::Summary
            ? (string) config('kedge.ai.summary_model', 'claude-haiku-4-5')
            : (string) config('kedge.ai.model', 'claude-sonnet-5');
    }

    /**
     * Whether a run belongs to the ONE PERSON who asked for it, rather than to
     * the document.
     *
     * A digest, an improve-prompt, a thread summary: all describe shared material,
     * so sharing them is the point — a second member joins the run instead of
     * re-billing the key. A reply draft is the opposite. It is written in the
     * requester's voice, for a position they chose and have not yet decided to
     * say out loud; handing it to another member would both answer the wrong
     * question and expose one person's unposted words to someone else.
     *
     * An ask joins it for the same reason one step earlier: the run carries a
     * question ONE PERSON typed, and run ids are sequential, so a workspace-wide
     * read would let any member walk the ledger and see what a colleague was
     * confused about. The panel that shows the answer is ephemeral; the row
     * behind it should be no more public than the panel was.
     *
     * The single predicate behind two rules: the ledger's dedupe key includes the
     * requester, and the Policy lets only the requester read the result.
     */
    public function isPerActor(): bool
    {
        return match ($this) {
            self::ReplyDraft, self::Ask => true,
            default => false,
        };
    }

    /**
     * Whether a request of this type ALWAYS mints its own run, bypassing the
     * ledger's in-flight dedupe.
     *
     * Dedupe exists because two people asking for "the digest of this document"
     * are asking the identical question, and billing the key twice for one
     * answer is waste. An ask breaks that premise: the request carries a
     * free-form question, so two asks against the same document are almost never
     * the same request, and joining them would hand the second asker an answer
     * to someone else's question — confidently, and about a passage they never
     * selected. Wrong beats expensive here.
     *
     * Declared as a property of the TYPE rather than a branch in the ledger for
     * the same reason {@see isPerActor()} is: the rule is about what the type
     * means, and a sixth type's author must answer the question deliberately
     * instead of inheriting whichever behaviour the control flow happened to
     * give them.
     *
     * The abuse guard this gives up is not lost — it moves to `throttle:ai`,
     * which bounds spend per actor per minute regardless of what is being asked.
     */
    public function isDedupeExempt(): bool
    {
        return $this === self::Ask;
    }
}
