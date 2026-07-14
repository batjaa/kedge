<?php

namespace App\Services\Fetch;

/**
 * What a completed fetch hands back to a caller (connectors, image re-hosting,
 * demo imports). Carries everything downstream normalization needs: the body, the
 * effective content type, the final URL after any redirects (for resolving
 * relative asset paths), and the status so callers can drive their own retry /
 * Retry-After logic on 4xx/5xx.
 */
class FetchResult
{
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly ?string $contentType,
        public readonly string $finalUrl,
    ) {}

    public function successful(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }
}
