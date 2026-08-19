<?php

namespace App\Policies;

use App\Models\AgentToken;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;
use Illuminate\Auth\Access\Response;

/**
 * Who may mint, list, and revoke **Agent Tokens** (SPEC §15; m4-ai-agents eng
 * review §7). Every agent-token route authorizes here — a token id in a URL is
 * never an access path.
 *
 * The gate is FULL workspace membership, and that is a deliberate hardening
 * rather than the usual "any authenticated user". M2's reviewer-via-share
 * identities are real, authenticated `users` rows; so is the visitor who
 * verified an email against an anonymous demo document's share. Neither owns a
 * workspace — and if either could mint, one shared document would become a
 * standing MCP credential. v1 tenancy is invisible (every real account owns
 * exactly one workspace), so "owns a personal workspace" IS the full-membership
 * test, and it denies both shadow identities structurally rather than by
 * enumerating them.
 *
 * Revoking additionally requires owning the token: a workspace peer's token id
 * is not a lever.
 *
 * Every method also refuses an actor who is itself authenticated by an agent
 * token. The REST v1 middleware already makes that unreachable — this is the
 * second lock on "an agent can never mint, list, or revoke a token", so the
 * invariant survives a route ever being served from somewhere else.
 */
class AgentTokenPolicy
{
    use AuthorizesWorkspaceMembership;

    public function viewAny(User $user): bool
    {
        return $this->fullMember($user);
    }

    public function create(User $user): bool
    {
        return $this->fullMember($user);
    }

    /**
     * Revoking is owner-only, and a foreign token answers 404 rather than 403.
     *
     * The distinction matters: token ids are globally sequential, so a plain
     * "forbidden" would confirm that id N is somebody's live credential. Denying
     * as not-found collapses "not yours" and "never existed" into one answer, so
     * the id space discloses nothing — while authorization stays where the house
     * rule puts it, in the Policy, not in a hand-scoped controller query.
     *
     * A caller who is not a full member is refused before any of that, with a
     * plain 403: they have no business on this surface at all.
     */
    public function delete(User $user, AgentToken $token): Response
    {
        if (! $this->fullMember($user)) {
            return Response::deny();
        }

        $isOwn = $token->tokenable_type === $user->getMorphClass()
            && (int) $token->tokenable_id === (int) $user->id;

        return $isOwn ? Response::allow() : Response::denyAsNotFound();
    }

    private function fullMember(User $user): bool
    {
        return ! $user->usingAgentToken()
            && $this->hasPersonalWorkspace($user);
    }
}
