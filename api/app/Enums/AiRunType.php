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
}
