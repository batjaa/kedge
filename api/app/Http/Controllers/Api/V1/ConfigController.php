<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\GitHubAuthService;
use Illuminate\Http\JsonResponse;

/**
 * Public capability surface (ticket #6). The web app has no way to know which
 * optional, credential-gated features the API has switched on — env lives only
 * on the API. This unauthenticated, rate-limited endpoint reports them so the
 * UI can hide what isn't configured (the GitHub button) instead of offering a
 * button that 404s. Minimal by design: booleans only, no secrets.
 */
class ConfigController extends Controller
{
    public function __construct(
        private readonly GitHubAuthService $github,
    ) {}

    /**
     * Report the runtime capabilities the web app needs to know about.
     */
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'auth' => [
                'github' => $this->github->isConfigured(),
            ],
            // Edition (#25). The web reads this to pick the anonymous home surface:
            // the paste-a-URL demo box on the SaaS, the sign-in redirect
            // self-hosted. Env lives only on the API, so this is the single source
            // of truth — the web never carries its own SELF_HOSTED var.
            'self_hosted' => (bool) config('kedge.self_hosted'),
        ]);
    }
}
