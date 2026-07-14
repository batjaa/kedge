<?php

namespace App\Services\Fetch\Exceptions;

use App\Services\Fetch\GuardedFetcher;
use RuntimeException;

/**
 * Base type for every failure of the guarded fetcher. Callers can catch this to
 * treat "the fetch didn't produce a usable response" uniformly, or catch the
 * concrete subclasses to distinguish blocked vs timeout vs too-large vs upstream
 * (see {@see GuardedFetcher}).
 */
abstract class FetchException extends RuntimeException {}
