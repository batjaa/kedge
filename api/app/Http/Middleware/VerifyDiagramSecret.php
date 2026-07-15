<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the internal diagram-render endpoint (SPEC §6.2), the mirror of the
 * web's projection guard with the roles swapped: here the API is the server and
 * the web presents the secret. The endpoint is internal — never publicly
 * reachable in the SaaS topology — so the guard is a shared secret enforced at
 * the app, not a proxy rule a topology change could quietly drop.
 *
 * Fail-closed: in production the secret MUST be configured (DIAGRAM_SHARED_SECRET);
 * absent it, the endpoint rejects every request rather than trusting a guessable
 * default. In dev it falls back to a well-known value the web app also defaults
 * to, so `npm run dev` renders diagrams out of the box.
 *
 * A bad or missing secret gets a 404, not a 401/403: an unauthorized caller never
 * learns the endpoint exists.
 */
class VerifyDiagramSecret
{
    private const HEADER = 'X-Diagram-Secret';

    private const DEV_SECRET = 'dev-diagram-secret';

    public function handle(Request $request, Closure $next): Response
    {
        $expected = $this->expectedSecret();
        $provided = (string) $request->header(self::HEADER, '');

        if ($expected === null || $provided === '' || ! hash_equals($expected, $provided)) {
            abort(404);
        }

        return $next($request);
    }

    /**
     * The secret the endpoint requires, or null when it must be disabled (fail
     * closed). Production with no configured secret returns null; dev falls back
     * to the shared well-known value.
     */
    private function expectedSecret(): ?string
    {
        $configured = config('kedge.diagram.secret');

        if (is_string($configured) && $configured !== '') {
            return $configured;
        }

        return app()->isProduction() ? null : self::DEV_SECRET;
    }
}
