<?php

namespace App\Services\Agents\Exceptions;

use RuntimeException;

/**
 * An agent-facing refusal (SPEC §15, #135): the one exception whose message is
 * safe to hand back over MCP verbatim.
 *
 * laravel/mcp turns an unrecognised Throwable into "An internal server error
 * occurred." and reports it — correct for a bug, useless for "that thread isn't
 * yours" or "you have spent this minute's write budget". Everything a tool means
 * to TELL the agent is raised as this type and caught at the tool boundary, so
 * nothing else can leak a message that was never written for an outside reader.
 */
class McpToolException extends RuntimeException
{
    //
}
