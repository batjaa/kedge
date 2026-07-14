<?php

namespace App\Services\Fetch\Exceptions;

/**
 * The response exceeded the size cap. Thrown either up front from a
 * Content-Length that overshoots the cap, or mid-stream once the bytes read
 * cross it — the body is never fully buffered before the check.
 */
class ResponseTooLargeException extends FetchException {}
