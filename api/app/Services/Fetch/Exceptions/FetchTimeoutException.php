<?php

namespace App\Services\Fetch\Exceptions;

/**
 * The connection or transfer exceeded the timeout cap — the "source timeout" /
 * "slow response" failure mode (SPEC 19). Distinct from an upstream 5xx so
 * callers can drive the import retry-with-backoff path.
 */
class FetchTimeoutException extends FetchException {}
