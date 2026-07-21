<?php

namespace App\Services\Reanchor\Exceptions;

use RuntimeException;

/**
 * The re-anchor endpoint rejected our request as malformed. Unlike endpoint
 * downtime, retrying the same payload will not heal it.
 */
class ReanchorRequestException extends RuntimeException {}
