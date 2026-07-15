<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates the instant-demo surface to the SaaS (SPEC §10.3, #25). When
 * `SELF_HOSTED=true` the whole surface — the anonymous import endpoint and the
 * claim endpoint — vanishes: every route behind this middleware 404s, exactly
 * as if it were never registered.
 *
 * The check is per request, not per boot: like the GitHub OAuth routes, the
 * demo routes register unconditionally and the feature toggles at request time,
 * so `config('kedge.self_hosted')` is the single source of truth and a test can
 * flip the edition without rebuilding the route table.
 */
class EnsureDemoModeEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_if(config('kedge.self_hosted'), 404);

        return $next($request);
    }
}
