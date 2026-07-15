<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreIntegrationRequest;
use App\Http\Resources\V1\IntegrationResource;
use App\Models\Integration;
use App\Policies\IntegrationPolicy;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Per-workspace integration credentials (SPEC §16, §13). A workspace connects a
 * GitHub PAT here to import private repos; the token is encrypted at rest and
 * never returned. Every action authorizes through {@see IntegrationPolicy}
 * — an integration id in a URL is never an access path.
 *
 * List and create are scoped to the caller's own personal workspace (M1 tenancy
 * is invisible), so cross-workspace reach is structurally impossible, not merely
 * policy-checked. Delete resolves a row by id and so is policy-guarded.
 */
class IntegrationController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/integrations — the workspace's connections, masked.
     *
     * Never resurrects a token: only provider, a last-4 hint, and created_at.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Integration::class);

        $integrations = $request->user()
            ->personalWorkspace()
            ->integrations()
            ->latest('id')
            ->get();

        return IntegrationResource::collection($integrations);
    }

    /**
     * POST /api/v1/integrations — connect a token for the workspace.
     *
     * The token is stored encrypted and the last-4 hint recorded for the masked
     * listing; the response carries only the mask, never the token back.
     */
    public function store(StoreIntegrationRequest $request): JsonResponse
    {
        $this->authorize('create', Integration::class);

        $workspace = $request->user()->personalWorkspace();
        $token = $request->token();

        $integration = $workspace->integrations()->create([
            'provider' => $request->provider(),
            'credentials' => ['token' => $token],
            'meta' => ['token_last_four' => substr($token, -4)],
        ]);

        // No token in the audit meta — only the non-sensitive provider + hint.
        $this->audit->record(
            $workspace,
            $request->user(),
            'integration.connected',
            $integration,
            ['provider' => $integration->provider->value, 'token_last_four' => $integration->tokenLastFour()],
            $request->ip(),
        );

        return IntegrationResource::make($integration)
            ->response()
            ->setStatusCode(201);
    }

    /**
     * DELETE /api/v1/integrations/{integration} — disconnect a token.
     *
     * Documents already imported through it keep their (immutable) content; only
     * a future re-import would need a reconnected token.
     */
    public function destroy(Request $request, Integration $integration): JsonResponse
    {
        $this->authorize('delete', $integration);

        $workspace = $integration->workspace;
        $provider = $integration->provider->value;

        $integration->delete();

        $this->audit->record(
            $workspace,
            $request->user(),
            'integration.removed',
            $integration,
            ['provider' => $provider],
            $request->ip(),
        );

        return response()->json(status: 204);
    }
}
