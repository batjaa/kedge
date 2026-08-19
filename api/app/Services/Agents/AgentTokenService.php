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
     * bearer by digest on every request, so the agent's very next call finds
     * nothing and fails — there is no cached grant to expire and no window to
     * race.
     *
     * Idempotent: revoking an already-gone token is a no-op.
     */
    public function revoke(AgentToken $token): void
    {
        $token->delete();
    }

    /**
     * A member's tokens, newest first — the settings list.
     *
     * @return Collection<int, AgentToken>
     */
    public function listFor(User $owner)
    {
        return $owner->tokens()->latest('id')->get();
    }
}
