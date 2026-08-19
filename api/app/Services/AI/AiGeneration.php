<?php

namespace App\Services\AI;

/**
 * What one completed generation produced: the structured output the panel
 * renders, the model that actually answered, and the spend to record.
 *
 * `meta` is the prompt-assembly metadata (chunk count, budget, skipped
 * sections) that lands in `ai_runs.input` — scope references and math, never
 * the assembled prompt text and never a credential.
 */
final class AiGeneration
{
    /**
     * @param  array<string, mixed>  $output
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public readonly array $output,
        public readonly ?string $model,
        public readonly int $tokens,
        public readonly ?float $cost,
        public readonly array $meta = [],
    ) {}
}
