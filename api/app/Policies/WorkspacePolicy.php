<?php

namespace App\Policies;

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * The workspace itself as a resource (SPEC §10.1, §16; M3.7 decisions 11A and
 * the dashboard summary). Both abilities are personal-workspace guards — an id
 * in a URL is never an access path — but they differ in strictness: reading the
 * dashboard summary needs any personal-workspace membership (a magic-link
 * reviewer, who holds none, is refused 403, never a 500), while renaming is
 * owner-only.
 *
 * v1 tenancy is invisible (every user owns exactly one workspace), so in
 * practice a workspace-less reviewer is the denied case; the owner check is
 * written against the role pivot so it stays correct the day team workspaces
 * add Member seats.
 */
class WorkspacePolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * Rename a workspace / edit its slug. Owner-only, and only for a workspace
     * the user actually belongs to as owner — a fresh (id-less) workspace or
     * one the user does not own both deny.
     */
    public function update(User $user, Workspace $workspace): bool
    {
        return $user->workspaces()
            ->whereKey($workspace->id)
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->exists();
    }

    /**
     * Read the workspace's dashboard summary (SPEC §16, M3.7 — the stats strip
     * and filter-chip counts). Mirrors {@see DocumentPolicy::viewAny()}.
     */
    public function viewSummary(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }
}
