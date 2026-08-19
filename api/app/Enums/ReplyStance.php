<?php

namespace App\Enums;

/**
 * The stance an author picks before asking for a reply draft (SPEC §14, m4 user
 * story 5): agree and close it out, disagree and say why, or ask for the missing
 * detail.
 *
 * The stance is the AUTHOR's decision, made before the model reads anything —
 * that is the whole point of the feature. The AI is told which reply to draft;
 * it never chooses the position, and it never posts the result (hard rule 5).
 *
 * Persisted in `ai_runs.variant` as part of the dedupe key, so add cases — never
 * re-spell one.
 */
enum ReplyStance: string
{
    case Accept = 'accept';
    case PushBack = 'push_back';
    case Clarify = 'clarify';
}
