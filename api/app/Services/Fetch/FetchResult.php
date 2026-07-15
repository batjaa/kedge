<?php

namespace App\Services\Fetch;

/**
 * What a completed fetch hands back to a caller (connectors, image re-hosting,
 * demo imports). Carries everything downstream normalization needs: the body, the
 * effective content type, the final URL after any redirects (for resolving
 * relative asset paths), and the status so callers can drive their own retry /
 * Retry-After logic on 4xx/5xx.
 *
 * Response headers are exposed (lower-cased) so a connector can read the signals a
 * rate-limited source sends back — `Retry-After`, GitHub's `X-RateLimit-*` — and
 * back off per the §19 registry rather than burning retries (#22).
 */
class FetchResult
{
    /**
     * @param  array<string, string>  $headers  Lower-cased response header name => value.
     */
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly ?string $contentType,
        public readonly string $finalUrl,
        public readonly array $headers = [],
    ) {}

    public function successful(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }

    /**
     * A single response header by name (case-insensitive), or null if absent.
     */
    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
