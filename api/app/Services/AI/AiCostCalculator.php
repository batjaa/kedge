<?php

namespace App\Services\AI;

use Laravel\Ai\Responses\Data\Usage;

/**
 * Turns SDK token usage into the ledger's `tokens` and `cost` (SPEC §19 — AI
 * cost/day is a day-1 metric).
 *
 * Prices live in `config('kedge.ai.pricing')` as USD per million tokens. An
 * UNPRICED model records a null cost rather than a wrong one: a missing number
 * is honest, a fabricated number silently corrupts the spend metric. Tokens are
 * still recorded either way.
 *
 * Cache reads and writes are billed at the input rate here — an approximation
 * the SDK's usage shape supports and one the digest path barely exercises (it
 * sets no cache breakpoints).
 */
class AiCostCalculator
{
    public function inputTokens(Usage $usage): int
    {
        return $usage->promptTokens + $usage->cacheWriteInputTokens + $usage->cacheReadInputTokens;
    }

    public function outputTokens(Usage $usage): int
    {
        return $usage->completionTokens + $usage->reasoningTokens;
    }

    public function totalTokens(Usage $usage): int
    {
        return $this->inputTokens($usage) + $this->outputTokens($usage);
    }

    /**
     * USD for this usage on this model, or null when the model has no price.
     */
    public function cost(?string $model, Usage $usage): ?float
    {
        if ($model === null) {
            return null;
        }

        // Indexed, not dot-pathed: a model id may legitimately contain dots.
        $table = config('kedge.ai.pricing', []);
        $pricing = is_array($table) ? ($table[$model] ?? null) : null;

        if (! is_array($pricing)) {
            return null;
        }

        $input = (float) ($pricing['input'] ?? 0);
        $output = (float) ($pricing['output'] ?? 0);

        return round(
            ($this->inputTokens($usage) / 1_000_000) * $input
            + ($this->outputTokens($usage) / 1_000_000) * $output,
            6,
        );
    }
}
