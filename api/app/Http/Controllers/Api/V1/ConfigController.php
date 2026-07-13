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
        ]);
    }
}
