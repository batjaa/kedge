<?php

namespace App\Services\Fetch\Exceptions;

use App\Services\Fetch\FetchResult;

/**
 * A transport-level failure that is not an SSRF block, timeout, or size overrun:
 * connection refused, TLS handshake failure, DNS lookup error. HTTP responses
 * with 4xx/5xx status are NOT this — the fetcher returns those as a
 * {@see FetchResult} so callers can read the status and
 * honour Retry-After (SPEC 19 failure registry).
 */
class UpstreamFetchException extends FetchException {}
