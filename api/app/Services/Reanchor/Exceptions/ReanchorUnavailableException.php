<?php

namespace App\Services\Reanchor\Exceptions;

use RuntimeException;

/**
 * The web-owned re-anchor endpoint could not produce a trustworthy batch result.
 * The resync job treats this as retryable so the document pointer stays on the
 * last good version while the target version remains created-but-not-current.
 */
class ReanchorUnavailableException extends RuntimeException {}
