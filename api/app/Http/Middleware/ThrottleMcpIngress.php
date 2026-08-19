<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * The per-IP ceiling on MCP traffic that has not authenticated yet (SPEC §13,
 * #135).
 *
 * `throttle:mcp` buckets per agent token, which is the right bucket — but it
 * cannot fire at all for a request that never authenticates: Laravel's
 * middleware priority resolves `auth:sanctum` in FRONT of `ThrottleRequests`, so
 * an anonymous or garbage-bearer call 401s before the limiter is reached. Left
 * alone, that is an unbounded ingress: every attempt costs a Sanctum token
 * lookup, and nothing counts it.
 *
 * So this runs first — hoisted to the front of the middleware priority list in
 * AppServiceProvider, ahead of the session stack and the guard, exactly as the
 * agent-token refusal is — and bounds by IP before any of that work happens.
 * The per-token limiter stays where it is and still bounds an authenticated
 * agent's own volume; the two are ceilings on different things.
 *
 * The bound is deliberately the SAME number as the per-token allowance: one IP
 * is one agent host in every topology we ship, so an honest agent never notices
 * this exists, and a probe finds the door shut after the same handful of tries.
 */
class ThrottleMcpIngress
{
    public function handle(Request $request, Closure $next): Response
    {
        $perMinute = max(1, (int) config('kedge.mcp.rate_per_minute', 120));
        $key = 'mcp-ingress:'.$request->ip();

        if (RateLimiter::tooManyAttempts($key, $perMinute)) {
            abort(429, 'Too many MCP requests.', [
                'Retry-After' => (string) RateLimiter::availableIn($key),
            ]);
        }

        RateLimiter::hit($key, 60);

        return $next($request);
    }
}
