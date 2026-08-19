<?php

namespace App\Policies\Concerns;

use App\Enums\WorkspaceRole;
use App\Models\AgentToken;
use App\Models\Document;
use App\Models\User;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The one place workspace reach is decided (SPEC §13; m4-ai-agents eng review
 * §2). Every Policy composes this trait rather than writing its own membership
 * query, for two reasons that have to hold together:
 *
 *   1. Membership — the actor belongs to the resource's workspace. An id in a
 *      URL is never an access path.
 *   2. Credential scope — when the actor authenticated with an **Agent Token**,
 *      that token must additionally carry the `workspace:{id}` ability for the
 *      resource's workspace. A token is therefore never broader than its
 *      owner's access, and can be narrower.
 *
 * Putting (2) here rather than in each MCP tool is the whole point: a future
 * tool author cannot forget a check they never had to write. First-party cookie
 * requests carry Sanctum's TransientToken (not an AgentToken), so (2) is a
 * no-op for humans.
 *
 * The two are not always both required: authorship-based reach (see
 * {@see authorOf()} and ResolvesShareReviewers::ownsSubjectInReachableDocument())
 * deliberately survives losing membership, per M2. Credential scope, by
 * contrast, applies everywhere without exception — there is no path by which an
 * agent token reaches a workspace it does not name.
 */
trait AuthorizesWorkspaceMembership
{
    protected function memberOf(User $user, Document $document): bool
    {
        return $this->memberOfWorkspace($user, $document->workspace_id);
    }

    /**
     * The canonical membership test: belongs to the workspace, and — if acting
     * through an agent token — holds that workspace's ability.
     */
    protected function memberOfWorkspace(User $user, int|string|null $workspaceId): bool
    {
        if ($workspaceId === null) {
            return false;
        }

        return $this->tokenReachesWorkspace($user, (int) $workspaceId)
            && $user->workspaces()->whereKey($workspaceId)->exists();
    }

    /**
     * The document's author.
     *
     * Authorship is deliberately NOT conditioned on current membership (M2: a
     * non-member author still moderates what they wrote — ThreadCommentTest), but
     * it IS conditioned on credential scope: an agent token must carry this
     * document's workspace ability before its owner's authorship counts for
     * anything.
     */
    protected function authorOf(User $user, Document $document): bool
    {
        return $this->ownedBy($user, $document->created_by)
            && $this->tokenReachesWorkspace($user, (int) $document->workspace_id);
    }

    protected function ownerOf(User $user, Document $document): bool
    {
        return $this->ownerOfWorkspace($user, $document->workspace_id);
    }

    /**
     * Owner-role membership. Written against the role pivot so it stays correct
     * the day team workspaces add Member seats.
     */
    protected function ownerOfWorkspace(User $user, int|string|null $workspaceId): bool
    {
        if ($workspaceId === null) {
            return false;
        }

        return $this->tokenReachesWorkspace($user, (int) $workspaceId)
            && $user->workspaces()
                ->whereKey($workspaceId)
                ->wherePivot('role', WorkspaceRole::Owner->value)
                ->exists();
    }

    protected function hasPersonalWorkspace(User $user): bool
    {
        $workspace = $user->personalWorkspace();

        return $workspace !== null
            && $this->tokenReachesWorkspace($user, (int) $workspace->id);
    }

    protected function ownedBy(User $user, mixed $userId): bool
    {
        return $userId !== null && (int) $userId === (int) $user->id;
    }

    /**
     * True unless the request authenticated with a persistent token that does not
     * carry this workspace's ability. Session-authenticated humans (Sanctum's
     * TransientToken) and non-HTTP callers (no token at all) always pass.
     *
     * Written to fail CLOSED on anything unexpected: a persistent token that is
     * not an {@see AgentToken} — a provider override, a future guard, a package
     * that registers its own model — gets no reach at all, rather than silently
     * inheriting a human's. The only way to reach a workspace with a stored
     * credential is to be an agent token that names it.
     */
    protected function tokenReachesWorkspace(User $user, int $workspaceId): bool
    {
        $token = $user->currentAccessToken();

        if (! $token instanceof PersonalAccessToken) {
            return true;
        }

        return $token instanceof AgentToken
            && $token->scopedToWorkspace($workspaceId);
    }
}
