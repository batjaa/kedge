<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates manual re-sync behind a rollout flag. Disabled means absent: callers get
 * a 404, matching the demo-mode feature-gate pattern.
 */
class EnsureResyncEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('kedge.resync.enabled', true), 404);

        return $next($request);
    }
}
