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
            // BYO key (SPEC §14, M4). False on an instance where the SELECTED
            // provider has no credential configured (#140) — the web then renders
            // no AI affordance at all, and the AI routes 404 to match. The web
            // treats a MISSING `ai` capability as false too, so a new web against
            // an old api shows nothing broken.
            //
            // One boolean, deliberately: this endpoint is unauthenticated, and
            // WHICH provider an instance runs is the operator's business, not the
            // browser's. The web needs to know only whether to draw the button.
            'ai' => [
                'enabled' => (bool) config('kedge.ai.enabled'),
            ],
            // The MCP surface (SPEC §15, M4). Reported SEPARATELY from `ai` on
            // purpose: the two gates are independent, so a keyless self-host
            // still hosts agent reviewers and still shows the agent-token
            // settings panel. The web reads this to decide whether minting a
            // credential means anything on this instance — a missing `mcp` block
            // (a new web against an api from before #135) reads as false, and
            // correctly so: that api has no MCP endpoint to point an agent at.
            'mcp' => [
                'enabled' => (bool) config('kedge.mcp.enabled'),
            ],
        ]);
    }
}
