<?php

namespace App\Services\AI\Prompt;

/**
 * One indivisible unit of prompt content — for the digest, one thread with its
 * comments. Chunking cuts BETWEEN sections, never inside one, so a chunk never
 * shows the model half a conversation.
 *
 * `body` is already fenced (a builder can only produce it through
 * {@see UntrustedFence}); `label` is trusted, ours, and used in the coverage
 * accounting and the run's `input` metadata.
 */
final class PromptSection
{
    public function __construct(
        public readonly string $label,
        public readonly string $body,
    ) {}
}
