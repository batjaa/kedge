<?php

namespace App\Services\AI\Exceptions;

/**
 * A targeted run reached its generator with no target to read — the comment a
 * split was requested for was deleted while the run sat in the queue.
 *
 * Deterministic: the target is not coming back, so retrying would bill the key
 * to discover the same absence. The run fails with a sentence that says what
 * happened, instead of a generic "unusable result" that sends the author
 * hunting for a model problem that isn't there.
 */
class MissingRunTargetException extends AiGenerationException
{
    public function code(): string
    {
        return 'target_missing';
    }

    public function userMessage(): string
    {
        return 'The comment this was requested for is no longer available.';
    }
}
