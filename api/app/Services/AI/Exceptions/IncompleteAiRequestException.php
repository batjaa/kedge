<?php

namespace App\Services\AI\Exceptions;

/**
 * A run reached its generator without the request content it was created to
 * answer — an ask with no question (M4 #139).
 *
 * Not reachable through the endpoint, which validates the question as required
 * before minting anything; reachable only from a hand-written row or a future
 * caller that forgets to pass one. Deterministic all the same: a retry cannot
 * invent the words the reader never sent, so the run fails at once rather than
 * billing the key three times to rediscover the same gap.
 */
class IncompleteAiRequestException extends AiGenerationException
{
    public function code(): string
    {
        return 'request_incomplete';
    }

    public function userMessage(): string
    {
        return 'This request arrived without a question to answer. Ask again.';
    }
}
