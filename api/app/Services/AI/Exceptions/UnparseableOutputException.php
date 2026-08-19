<?php

namespace App\Services\AI\Exceptions;

/**
 * The model returned structured output that does not match the shape the digest
 * needs, after the SDK has already done its own parsing/retry. Deterministic:
 * the same prompt will keep producing the same unusable answer, so the run fails
 * at once instead of retrying (spec, failure split).
 */
class UnparseableOutputException extends AiGenerationException
{
    public function code(): string
    {
        return 'unparseable_output';
    }

    public function userMessage(): string
    {
        return 'Generation failed — the model returned an unusable result. Retry.';
    }
}
