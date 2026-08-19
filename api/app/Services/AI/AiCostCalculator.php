<?php

namespace App\Services\AI;

use Laravel\Ai\Responses\Data\Usage;

/**
 * Turns SDK token usage into the ledger's `tokens` and `cost` (SPEC §19 — AI
 * cost/day is a day-1 metric).
 *
 * Prices live in `config('kedge.ai.pricing')` as USD per million tokens, under
 * the provider that charges them. An UNPRICED model records a null cost rather
 * than a wrong one: a missing number is honest, a fabricated number silently
 * corrupts the spend metric. Tokens are still recorded either way.
 *
 * "Unpriced" includes a priced model id served by a DIFFERENT provider (#140) —
 * a reseller, a cloud marketplace, or a local runtime charges its own rate (or
 * nothing), so the certified provider's table must not be applied to it. The
 * provider is read at call time, like every other AI config value, and a run is
 * priced moments after the call that made it.
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
     * USD for this usage on this model, or null when the selected provider has
     * no price for it.
     */
    public function cost(?string $model, Usage $usage): ?float
    {
        if ($model === null) {
            return null;
        }

        // Indexed, not dot-pathed: a provider or model id may legitimately
        // contain dots (`gpt-4.1`, `llama3.1`).
        $table = config('kedge.ai.pricing', []);
        $provider = (string) config('kedge.ai.provider', '');
        $forProvider = is_array($table) ? ($table[$provider] ?? null) : null;
        $pricing = is_array($forProvider) ? ($forProvider[$model] ?? null) : null;

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
