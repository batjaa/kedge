<?php

namespace App\Policies;

use App\Models\Integration;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * Integrations are reachable only within their workspace (SPEC §13, user story
 * 21): an id in a URL is never an access path. Every integration route
 * authorizes through here — no inline ownership checks in controllers. Share
 * reviewers never receive integration access; this policy is workspace-member
 * only.
 *
 * Listing and creating are scoped to the actor's own personal workspace in the
 * controller (M1 tenancy is invisible), so any authenticated user may — they can
 * only ever see or add to their own. Deleting resolves a specific row by id, so
 * it must verify the actor belongs to that row's workspace.
 */
class IntegrationPolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * List integrations — always the caller's own workspace's (controller-scoped).
     */
    public function viewAny(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Connect an integration — it lands in the caller's own workspace.
     */
    public function create(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Remove an integration. Workspace members only — a foreign integration id is
     * never an access path.
     */
    public function delete(User $user, Integration $integration): bool
    {
        return $user->workspaces()
            ->whereKey($integration->workspace_id)
            ->exists();
    }
}
