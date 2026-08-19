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
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Agent-token management for a workspace member (SPEC §15, #131). Every action
 * authorizes through {@see AgentTokenPolicy} — full workspace membership, and
 * ownership for revoke; a token id in a URL is never an access path.
 *
 * These routes live on REST v1 deliberately, which is what makes "an agent can
 * never mint a token" structural rather than promised: the whole API refuses
 * token authentication (RejectAgentTokenAuth), so minting, listing, and
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
     *
     * The credential and its audit record commit together: an audit failure must
     * not leave a live, untraceable token behind whose value the operator never
     * even received. Rolling both back is safe — nothing has been handed out yet.
     */
    public function store(StoreAgentTokenRequest $request): JsonResponse
    {
        $this->authorize('create', AgentToken::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $issued = DB::transaction(function () use ($request, $user, $workspace) {
            // Inside the transaction, on locked rows: two mints racing at the cap
            // must not both see room. (SQLite has no row locks, so there the cap
            // is best-effort — it is a sanity ceiling, not a billing boundary.)
            if ($this->tokens->countForUpdate($user) >= AgentTokenService::PER_MEMBER_CAP) {
                throw ValidationException::withMessages([
                    'name' => 'You already have '.AgentTokenService::PER_MEMBER_CAP
                        .' agent tokens. Revoke one before creating another.',
                ]);
            }

            $issued = $this->tokens->issue($user, $workspace, $request->tokenName());

            // Name and id only — the value never reaches the trail, the logs, or
            // any other store.
            $this->audit->record(
                $workspace,
                $user,
                AuditEvent::AgentTokenCreated,
                $issued->accessToken,
                ['name' => $issued->accessToken->name],
                $request->ip(),
            );

            return $issued;
        });

        return AgentTokenResource::make($issued->accessToken)
            ->withPlainTextValue($issued->plainTextToken)
            ->response()
            ->setStatusCode(201)
            // The one response in the app that carries a credential: keep it out
            // of every cache, including the back/forward store.
            ->header('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate, private')
            ->header('Pragma', 'no-cache');
    }

    /**
     * DELETE /api/v1/agent-tokens/{agentToken} — revoke a token.
     *
     * Instant by construction: the row is the credential, so the agent's next
     * call fails.
     *
     * The id is resolved through the caller's OWN tokens, so a foreign id and one
     * that never existed produce a byte-identical 404 — token ids are globally
     * sequential, and a 403/404 split (or two differently-worded 404 bodies)
     * would turn the id space into a "whose credential is live?" oracle. That is
     * binding, not authorization: {@see AgentTokenPolicy} still runs, and remains
     * the only thing that decides.
     *
     * Revocation is security-first: it is committed before the trail is written,
     * and a failing audit write is logged rather than thrown, because an
     * observability outage must never resurrect a credential the operator has
     * already been told is gone. The audit event fires only for the request that
     * actually removed the row, so two concurrent revokes leave one event.
     */
    public function destroy(Request $request, string $agentToken): JsonResponse
    {
        $user = $request->user();

        /** @var AgentToken|null $token */
        $token = $user->tokens()->whereKey($agentToken)->first();

        abort_if($token === null, 404);

        $this->authorize('delete', $token);

        if ($this->tokens->revoke($token)) {
            $this->audit->recordSafely(
                $user->personalWorkspace(),
                $user,
                AuditEvent::AgentTokenRevoked,
                $token,
                ['name' => $token->name],
                $request->ip(),
            );
        }

        return response()->json(status: 204);
    }
}
