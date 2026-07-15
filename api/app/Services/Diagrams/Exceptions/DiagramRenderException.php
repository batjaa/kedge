<?php

namespace App\Services\Diagrams\Exceptions;

use RuntimeException;

/**
 * A diagram could not be rendered — Kroki was unreachable, returned a non-2xx
 * (the usual signal of a bad-source diagram), produced a non-SVG or oversized
 * body, or the SVG failed sanitization. Never fatal: the controller maps it to a
 * 422 and the web shows the never-crash show-source panel (SPEC §6.2).
 *
 * `$detail` is the OPTIONAL, already-sanitized reason to surface to the author
 * beside the source (issue #56): for a bad-source diagram it is Kroki's own
 * error body (untrusted — stripped of control chars and truncated by the
 * renderer); for an infrastructure failure it is a generic message that leaks no
 * internals; and it is null when there is nothing safe or useful to show (the
 * panel then renders exactly as before). The `$message` stays operator-facing
 * (logs, exception traces) and is never sent to the web.
 */
class DiagramRenderException extends RuntimeException
{
    public function __construct(string $message = '', public readonly ?string $detail = null)
    {
        parent::__construct($message);
    }
}
