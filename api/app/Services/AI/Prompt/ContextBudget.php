<?php

namespace App\Services\AI\Prompt;

/**
 * The per-run context budget (SPEC §14). Prompt builders measure assembled input
 * against this ceiling; over budget, the assembler chunks by section rather than
 * truncating, and whatever still doesn't fit is reported as coverage.
 *
 * `maxTokens` is the ceiling for ONE model call's assembled input — deliberately
 * far below the model's real window so instructions and the response always fit.
 * `maxChunks` bounds how many calls a single run may make: an enormous review
 * costs a bounded amount and states honestly what it covered.
 *
 * Token counting is an estimate, not a tokenizer: ~4 characters per token, the
 * standard conservative heuristic. It is used only to decide where to cut, and
 * the ceiling carries enough headroom that the estimate's error is irrelevant —
 * calling the real tokenizer would mean a network round trip per section.
 */
final class ContextBudget
{
    public function __construct(
        public readonly int $maxTokens,
        public readonly int $maxChunks,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            maxTokens: max(1, (int) config('kedge.ai.context_tokens', 24000)),
            maxChunks: max(1, (int) config('kedge.ai.max_chunks', 4)),
        );
    }

    /**
     * Estimated tokens for a string.
     */
    public function estimate(string $text): int
    {
        return (int) ceil(mb_strlen($text) / 4);
    }
}
