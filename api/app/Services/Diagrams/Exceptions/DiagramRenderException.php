<?php

namespace App\Services\Diagrams\Exceptions;

use RuntimeException;

/**
 * A diagram could not be rendered — Kroki was unreachable, returned a non-2xx
 * (the usual signal of a bad-source diagram), produced a non-SVG or oversized
 * body, or the SVG failed sanitization. Never fatal: the controller maps it to a
 * 422 and the web shows the never-crash show-source panel (SPEC §6.2).
 */
class DiagramRenderException extends RuntimeException {}
