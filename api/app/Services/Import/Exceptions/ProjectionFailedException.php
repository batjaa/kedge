<?php

namespace App\Services\Import\Exceptions;

/**
 * The web projection endpoint could not produce a projection — it was
 * unreachable, timed out, returned a non-2xx status, or returned a malformed
 * body. A subclass of {@see ImportFailedException} so it flows through the SAME
 * transient retry path (SPEC §19): the import job retries ×3 with backoff, and
 * only a spent budget marks the document failed.
 *
 * Projection is never skipped on failure — a version that reached `ready` always
 * carries its anchor substrate, never a silently-unprojected one (SPEC §5.4).
 */
class ProjectionFailedException extends ImportFailedException {}
