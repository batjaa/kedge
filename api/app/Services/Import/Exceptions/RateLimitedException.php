<?php

namespace App\Services\Import\Exceptions;

use RuntimeException;

/**
 * A source told us it is rate-limiting us — GitHub answering a public request with
 * 429, or 403 + `X-RateLimit-Remaining: 0` (#22, SPEC §19 "GitHub 403/429 → honor
 * Retry-After"). Distinct from {@see ImportFailedException}: the import job does
 * not spend an exception against its failure budget for this. Instead it releases
 * the job back onto the queue after {@see $retryAfter} seconds so the import backs
 * off and resumes — the user sees "Rate-limited, retrying", never "failed".
 */
class RateLimitedException extends RuntimeException
{
    public function __construct(
        public readonly int $retryAfter,
        string $message = 'Source is rate-limiting the import.',
    ) {
        parent::__construct($message);
    }
}
