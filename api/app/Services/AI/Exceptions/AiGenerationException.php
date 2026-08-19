<?php

namespace App\Services\AI\Exceptions;

use App\Enums\AiFailureKind;
use App\Services\AI\AiFailure;
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

    /**
     * The ledger record for this failure. Lives here so a case's code and
     * sentence are written once, whether the exception was thrown by a generator
     * or synthesized by the classifier from a provider response.
     */
    public function asFailure(): AiFailure
    {
        return new AiFailure(AiFailureKind::Deterministic, $this->code(), $this->userMessage());
    }
}
