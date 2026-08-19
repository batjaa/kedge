<?php

namespace App\Policies\Concerns;

use App\Enums\WorkspaceRole;
use App\Models\AgentToken;
use App\Models\Document;
use App\Models\User;

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
     * True unless the request authenticated with an agent token that lacks this
     * workspace's ability. Session-authenticated humans always pass.
     */
    protected function tokenReachesWorkspace(User $user, int $workspaceId): bool
    {
        $token = $user->currentAccessToken();

        return ! $token instanceof AgentToken
            || $token->scopedToWorkspace($workspaceId);
    }
}
