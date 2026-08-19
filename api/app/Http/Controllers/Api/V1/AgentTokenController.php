<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AuditEvent;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreAgentTokenRequest;
use App\Http\Resources\V1\AgentTokenResource;
use App\Models\AgentToken;
use App\Policies\AgentTokenPolicy;
use App\Services\Agents\AgentTokenService;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Agent-token management for a workspace member (SPEC §15, #131). Every action
 * authorizes through {@see AgentTokenPolicy} — full workspace membership, and
 * ownership for revoke; a token id in a URL is never an access path.
 *
 * These routes live on REST v1 deliberately, which is what makes "an agent can
 * never mint a token" structural rather than promised: the whole v1 group
 * refuses token authentication (RejectAgentTokenAuth), so minting, listing, and
 * revoking are reachable only from a human's first-party session.
 */
class AgentTokenController extends Controller
{
    public function __construct(
        private readonly AgentTokenService $tokens,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/agent-tokens — the caller's tokens, newest first.
     *
     * Never resurrects a value: only name, last-used, and created-at. `last_used_at`
     * is Sanctum's own stamp, written every time the agent authenticates, so the
     * list answers "is this thing still working?" without any extra plumbing.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', AgentToken::class);

        return AgentTokenResource::collection(
            $this->tokens->listFor($request->user()),
        );
    }

    /**
     * POST /api/v1/agent-tokens — mint a named token for one agent.
     *
     * The value is returned exactly once, here (the Share-token idiom). The scope
     * is the caller's own workspace, derived server-side.
     */
    public function store(StoreAgentTokenRequest $request): JsonResponse
    {
        $this->authorize('create', AgentToken::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $issued = $this->tokens->issue($user, $workspace, $request->tokenName());

        /** @var AgentToken $token */
        $token = $issued->accessToken;

        // Name and id only — the value never reaches the trail, the logs, or any
        // other store.
        $this->audit->record(
            $workspace,
            $user,
            AuditEvent::AgentTokenCreated,
            $token,
            ['name' => $token->name],
            $request->ip(),
        );

        return AgentTokenResource::make($token)
            ->withPlainTextValue($issued->plainTextToken)
            ->response()
            ->setStatusCode(201);
    }

    /**
     * DELETE /api/v1/agent-tokens/{agentToken} — revoke a token.
     *
     * Instant by construction: the row is the credential, so the agent's next
     * call fails.
     */
    public function destroy(Request $request, AgentToken $agentToken): JsonResponse
    {
        $this->authorize('delete', $agentToken);

        $workspace = $request->user()->personalWorkspace();

        $this->tokens->revoke($agentToken);

        $this->audit->record(
            $workspace,
            $request->user(),
            AuditEvent::AgentTokenRevoked,
            $agentToken,
            ['name' => $agentToken->name],
            $request->ip(),
        );

        return response()->json(status: 204);
    }
}
