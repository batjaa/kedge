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
}
