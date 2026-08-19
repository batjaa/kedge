<?php

namespace App\Services\AI\Exceptions;

use App\Enums\AiRunType;

/**
 * A run was queued for a type with no registered generator. Only reachable if a
 * later M4 ticket reserves an {@see AiRunType} case and ships an
 * endpoint for it without registering its generator — deterministic, so the run
 * fails immediately and loudly instead of retrying three times.
 */
class UnsupportedAiRunTypeException extends AiGenerationException
{
    public function code(): string
    {
        return 'unsupported_type';
    }

    public function userMessage(): string
    {
        return 'This generation is not available on this instance.';
    }
}
