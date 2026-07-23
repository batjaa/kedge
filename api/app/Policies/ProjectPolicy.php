<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * Projects are reachable only within their workspace (SPEC §13, §16, user story
 * 19): an id in a URL is never an access path. Every project route authorizes
 * through here — no inline ownership checks in controllers. Mirrors
 * {@see DocumentPolicy}: a magic-link reviewer holds no personal workspace and
 * is refused 403 (never a 500); a foreign project id is never an access path.
 *
 * Listing and creating are scoped to the caller's own personal workspace in the
 * controller (M1 tenancy is invisible), so any personal-workspace holder may.
 * Updating resolves a specific row by id, so it verifies the actor belongs to
 * that row's workspace.
 */
class ProjectPolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * List the workspace's projects. Personal-workspace holders only — a
     * workspace-less reviewer gets 403, never a 500 (mirrors DocumentPolicy).
     */
    public function viewAny(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Create a project — it lands in the caller's own personal workspace.
     */
    public function create(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Rename / re-describe a project. Workspace members only; a foreign project
     * id is never an access path.
     */
    public function update(User $user, Project $project): bool
    {
        return $user->workspaces()
            ->whereKey($project->workspace_id)
            ->exists();
    }
}
