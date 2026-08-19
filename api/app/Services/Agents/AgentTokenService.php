<?php

namespace App\Services\Agents;

use App\Models\AgentToken;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Collection;
use Laravel\Sanctum\NewAccessToken;

/**
 * Issues and revokes **Agent Tokens** (SPEC §15, #131). Business logic lives
 * here, not in the controller: what a token is named, what it is scoped to, and
 * what revoking means are one concern with one home.
 *
 * The scope is derived, never accepted from the caller — an agent token reaches
 * exactly one workspace, and nothing in a request body can widen that.
 */
class AgentTokenService
{
    /**
     * How many tokens one member may hold at once.
     *
     * A ceiling, not a quota: nobody legitimately runs fifty agents, and it is
     * what keeps the (unpaginated, owner-scoped) settings list bounded no matter
     * how the mint limiter is tuned.
     */
    public const PER_MEMBER_CAP = 50;

    /**
     * Mint a named token for one agent, scoped to a single workspace.
     *
     * Returns Sanctum's {@see NewAccessToken}, whose `plainTextToken` is the only
     * moment the value exists in the clear — the caller surfaces it once and it is
     * then unrecoverable: the row keeps only its SHA-256 digest.
     */
    public function issue(User $owner, Workspace $workspace, string $name): NewAccessToken
    {
        return $owner->createToken($name, [AgentToken::workspaceAbility($workspace->id)]);
    }

    /**
     * Revoke a token. Deleting the row is the revocation: Sanctum resolves the
     * bearer by digest on every request, so the agent's next call finds nothing
     * and fails — there is no cached grant to expire.
     *
     * Returns whether THIS call removed the row. Two operators revoking the same
     * token concurrently both hold a bound model, so the delete is conditional on
     * the row still existing and only the winner reports true — the audit trail
     * gets one revocation event, not one per racer. (A request that authenticated
     * before the delete still finishes; making that linearizable is the MCP
     * server's write-path concern — #135, TODOS.)
     */
    public function revoke(AgentToken $token): bool
    {
        return AgentToken::query()->whereKey($token->getKey())->delete() > 0;
    }

    /**
     * A member's tokens, newest first — the settings list.
     *
     * @return Collection<int, AgentToken>
     */
    public function listFor(User $owner): Collection
    {
        return $owner->tokens()->latest('id')->get();
    }

    /**
     * How many tokens the member already holds — the cap check at mint.
     */
    public function countFor(User $owner): int
    {
        return $owner->tokens()->count();
    }
}
