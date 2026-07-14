<?php

namespace App\Services\Import\Exceptions;

use App\Services\Fetch\Exceptions\BlockedUrlException;
use RuntimeException;

/**
 * A transient import failure a connector raises for a non-blocked problem — an
 * upstream non-2xx status, an empty body, an undecodable payload. Distinct from
 * {@see BlockedUrlException} (deterministic, never
 * retried): this one lets the import job exhaust its retry budget (SPEC 19)
 * before marking the document failed.
 */
class ImportFailedException extends RuntimeException {}
