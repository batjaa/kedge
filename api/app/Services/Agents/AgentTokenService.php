<?php

namespace App\Services\Agents;

use App\Http\Middleware\RequireAgentTokenAuth;
use App\Models\AgentToken;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Auth\AuthenticationException;
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
     * gets one revocation event, not one per racer.
     *
     * Linearizable against in-flight MCP writes since #135: every MCP write
     * re-reads its own token row FOR UPDATE inside the write transaction
     * ({@see revalidateForWrite()}), so this delete and that write serialize on
     * the same row. Whichever commits first wins, and "no write commits after
     * revoke returned 204" holds on any engine with row locks.
     */
    public function revoke(AgentToken $token): bool
    {
        return AgentToken::query()->whereKey($token->getKey())->delete() > 0;
    }

    /**
     * Re-assert, inside the caller's write transaction, that the acting
     * credential still exists — the linearizability half of revocation (#135;
     * the debt #131 recorded).
     *
     * Sanctum resolves the bearer once, at authentication. Without this, a
     * request that authenticated a millisecond before {@see revoke()} would run
     * to completion on a credential the operator has already been told is gone:
     * "the agent's NEXT call fails" would hold, but "no write commits after
     * revoke returns 204" would not — and revocation on a review surface has to
     * mean the stronger thing.
     *
     * `lockForUpdate()` is what makes it an ordering and not just a re-read: the
     * row is held from here until the write commits, so a concurrent delete
     * blocks behind it rather than interleaving. (SQLite has no row locks and
     * ignores the clause; there the re-read still closes the common case — a
     * revoke that committed before the write began — and the barrier test is
     * gated to an engine that can prove the rest.)
     *
     * Fails CLOSED on anything that is not an agent token: the MCP surface is
     * the only caller, {@see RequireAgentTokenAuth} has
     * already established that a token is what is speaking, and a write path
     * that quietly accepted some other principal is exactly the drift this
     * whole ticket exists to prevent.
     *
     * @throws AuthenticationException
     */
    public function revalidateForWrite(User $agent): void
    {
        $token = $agent->currentAccessToken();

        if (! $token instanceof AgentToken) {
            throw new AuthenticationException('This write requires an agent token.');
        }

        $stillLive = AgentToken::query()
            ->whereKey($token->getKey())
            ->lockForUpdate()
            ->exists();

        if (! $stillLive) {
            throw new AuthenticationException('This agent token has been revoked.');
        }
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
     *
     * Locks the owner's rows, so it is only meaningful inside a transaction: two
     * mints racing at the cap must not both read room. SQLite has no row locks
     * and ignores the clause; the cap is a sanity ceiling, not a boundary
     * anything depends on being exact.
     */
    public function countForUpdate(User $owner): int
    {
        return $owner->tokens()->lockForUpdate()->count();
    }
}
