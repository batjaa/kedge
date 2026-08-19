<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\Response;

/**
 * Agent tokens are MCP-only, by construction (SPEC §15; m4-ai-agents eng review
 * §1 — the review's central decision).
 *
 * Sanctum's default would let an Agent Token authenticate on EVERY route in the
 * `auth:sanctum` group — handing agents the human-only endpoints (approvals,
 * lifecycle, suggestion accept/decline, shares, sign-out) and silently
 * bypassing the closed MCP tool list, which is the whole guarantee behind
 * "human-only by construction".
 *
 * So the default is inverted: this middleware is prepended to BOTH route groups
 * in bootstrap/app.php, and any request carrying a bearer credential is rejected
 * before the guard ever looks it up. Accepting a token is therefore a positive
 * capability that exactly one surface opts into — the MCP endpoint (#135), via
 * `->withoutMiddleware(RejectAgentTokenAuth::class)` on its route group. Nothing
 * new is fail-open by omission.
 *
 * Three properties follow, and they are the point:
 *
 *   1. Every human action — REST v1, sign-out, every route a later ticket adds —
 *      rejects an agent-token principal, without anyone remembering to opt in.
 *   2. The first-party BFF cookie path is untouched: SPA requests carry a
 *      session cookie and no Authorization header, so nothing here fires.
 *   3. Tokens cannot self-replicate. Mint/list/revoke live on REST v1, so an
 *      agent can never mint another token — not even its own successor.
 *
 * Rejecting on the presence of the credential (not on a successful lookup) is
 * deliberate: it is the only version of this rule that cannot be defeated by a
 * timing difference, a future guard change, or a route that resolves the user
 * lazily. It also means a token holder learns nothing — no lookup happens, so
 * there is no validity oracle and no `last_used_at` side effect.
 *
 * Extraction mirrors Sanctum's own — including a customized retrieval callback,
 * should one ever be registered — so the check can never drift from the guard
 * it is guarding.
 */
class RejectAgentTokenAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($this->carriesToken($request)) {
            abort(401, 'Agent tokens are valid only on the MCP endpoint; this API is human-only.');
        }

        return $next($request);
    }

    /**
     * The credential Sanctum's guard would try to authenticate, if any.
     */
    private function carriesToken(Request $request): bool
    {
        $token = is_callable(Sanctum::$accessTokenRetrievalCallback)
            ? (string) (Sanctum::$accessTokenRetrievalCallback)($request)
            : (string) $request->bearerToken();

        return trim($token) !== '';
    }
}
