<?php

namespace App\Http\Middleware;

use App\Models\AgentToken;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The exact mirror of {@see RejectAgentTokenAuth} (SPEC §15, #131/#135): REST
 * v1 refuses an Agent Token, and the MCP endpoint accepts NOTHING ELSE.
 *
 * Without this the pairing is only half-built. `auth:sanctum` also authenticates
 * the first-party SPA cookie (Sanctum's stateful path), so a signed-in human's
 * browser could drive the MCP tools — and every comment it wrote would be
 * stamped `client: mcp` and rendered with the violet `AGENT · MCP` badge. The
 * badge is a product promise ("never disguised as human", user story 15), and it
 * only holds if the surface that stamps it can be reached by nothing but an
 * agent credential. So the check is on the CREDENTIAL, not on the human: a
 * session, a TransientToken, or any persistent token that is not an
 * {@see AgentToken} is refused here, before a tool ever runs.
 *
 * It runs after authentication (it needs the resolved principal), which is why
 * it is not a substitute for the Policy trait's credential scoping — that
 * decides WHICH workspace this token reaches; this decides only that a token is
 * what is speaking.
 */
class RequireAgentTokenAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        abort_unless(
            $token instanceof AgentToken,
            401,
            'The MCP endpoint accepts only an agent token; sign-in sessions belong on the human API.',
        );

        return $next($request);
    }
}
