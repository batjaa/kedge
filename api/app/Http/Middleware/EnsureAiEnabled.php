<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The BYO-key gate (SPEC §14). With no credential configured for the SELECTED
 * provider (#140), the entire AI surface is ABSENT, not broken: every route
 * behind this middleware 404s as if it were never registered, and `/config`
 * reports `ai.enabled: false` so the web renders no AI affordance at all.
 *
 * Fail-closed by default — `config('kedge.ai.enabled')` is false unless the
 * selected provider has a key — and checked per request, like the demo and
 * re-sync gates, so a test (or an operator rotating a key, or switching
 * providers) flips the feature without rebuilding routes.
 */
class EnsureAiEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('kedge.ai.enabled', false), 404);

        return $next($request);
    }
}
