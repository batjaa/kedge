<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The MCP gate (SPEC §15, #135) — the established feature-flag middleware
 * pattern (demo, re-sync, AI), applied to the agent surface.
 *
 * Deliberately INDEPENDENT of {@see EnsureAiEnabled}: MCP is an API surface,
 * not an inference feature, so an instance with no Anthropic key still hosts
 * agent reviewers. Reading `kedge.mcp.enabled` and nothing else is what keeps
 * the two gates from quietly fusing — a keyless self-host must still be able to
 * mint a token and point an agent at it.
 *
 * Default ON (see config/kedge.php), so this only ever fires for an operator
 * who switched the surface off; when it does, the endpoint is ABSENT (404), and
 * `/config` reports `mcp.enabled: false` so the web hides the token panel
 * rather than minting credentials nothing is listening for.
 */
class EnsureMcpEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('kedge.mcp.enabled', false), 404);

        return $next($request);
    }
}
