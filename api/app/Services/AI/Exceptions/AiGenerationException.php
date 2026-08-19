<?php

namespace App\Services\AI\Exceptions;

use RuntimeException;

/**
 * Base for failures Kedge itself raises during a generation (as opposed to the
 * provider errors the SDK raises). Every one of these is deterministic — a
 * retry would produce the same result — so the classifier fails the run
 * immediately rather than burning the queue.
 */
abstract class AiGenerationException extends RuntimeException
{
    /**
     * The stable machine code stored on `ai_runs.error.code`.
     */
    abstract public function code(): string;

    /**
     * The sentence the web shows next to the retry action.
     */
    abstract public function userMessage(): string;
}
