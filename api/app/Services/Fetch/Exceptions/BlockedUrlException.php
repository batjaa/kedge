<?php

namespace App\Services\Fetch\Exceptions;

use App\Services\Fetch\BlockReason;

/**
 * The SSRF guard refused the URL: bad scheme, a host that resolved to a
 * private/reserved address, or a redirect that tried to escape the allowlist.
 *
 * This is the caller-distinguishable "blocked" signal (issue #16): connectors and
 * demo mode catch it to surface "URL not allowed (private address)" while letting
 * timeouts, oversized bodies, and upstream errors fall through as their own types.
 */
class BlockedUrlException extends FetchException
{
    public function __construct(
        public readonly BlockReason $reason,
        string $message,
    ) {
        parent::__construct($message);
    }

    /**
     * The message safe to show an end user. Deliberately uniform across reasons so
     * the guard never discloses which internal address a URL resolved to.
     */
    public function userMessage(): string
    {
        return 'URL not allowed (private address).';
    }
}
