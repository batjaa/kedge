<?php

namespace App\Services\Fetch;

use Psr\Http\Message\StreamInterface;

/**
 * A single hop's response with its body left as an unread stream. Keeping the body
 * lazy is what lets {@see GuardedFetcher} enforce the size cap mid-transfer and
 * abort before buffering an oversized payload, and lets it skip reading a
 * redirect's body entirely.
 */
class StreamedResponse
{
    /**
     * @param  array<string, string>  $headers  Lower-cased header name => value (first value per name).
     */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly StreamInterface $body,
    ) {}

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function isRedirect(): bool
    {
        return $this->status >= 300 && $this->status < 400;
    }
}
