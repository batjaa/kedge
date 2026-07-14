<?php

namespace App\Services\Import\Exceptions;

use RuntimeException;

/**
 * No registered connector claimed the source URL. Surfaced to the caller as a
 * 422 at import time; it should be caught earlier at the request boundary in the
 * happy path, but the importer stays defensive.
 */
class UnsupportedSourceException extends RuntimeException {}
