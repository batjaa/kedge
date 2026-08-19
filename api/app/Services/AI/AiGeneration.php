<?php

namespace App\Services\AI;

/**
 * What one completed generation produced: the structured output the panel
 * renders.
 *
 * Spend is deliberately NOT carried here. Tokens and cost are written to the
 * ledger by {@see AiRunLedger::recordSpend()} the moment each model call
 * returns, so a run that fails halfway still reports what it already spent —
 * a value object handed back only on success could never do that.
 */
final class AiGeneration
{
    /**
     * @param  array<string, mixed>  $output
     */
    public function __construct(
        public readonly array $output,
    ) {}
}
