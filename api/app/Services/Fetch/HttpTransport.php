<?php

namespace App\Services\Fetch;

use App\Services\Fetch\Exceptions\FetchTimeoutException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;

/**
 * The single-hop HTTP boundary. {@see GuardedFetcher} owns all policy — scheme
 * checks, DNS resolution, address validation, redirect following, size caps — and
 * delegates only the act of sending one already-pinned request here. That split is
 * what makes the guard testable: tests inject a fake transport to script
 * redirects, oversized bodies, and timeouts, while the real transport does the
 * curl-level pin-and-connect.
 *
 * Implementations MUST NOT follow redirects (the guard re-validates each hop
 * itself) and MUST connect only to {@see PinnedRequest::$pinnedIps}.
 */
interface HttpTransport
{
    /**
     * @throws FetchTimeoutException When the connection or transfer times out.
     * @throws UpstreamFetchException On any other transport failure (connection refused, TLS error).
     */
    public function send(PinnedRequest $request): StreamedResponse;
}
