<?php

namespace App\Policies;

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;

/**
 * A workspace is editable only by its owner (SPEC §16, M3.7 decision 11A). The
 * update endpoint is scoped to the caller's own personal workspace — an id in a
 * URL is never an access path — so this policy is the second guard: even the
 * caller's own workspace is renamable only when they hold the Owner role.
 *
 * v1 tenancy is invisible (every user owns exactly one workspace), so in practice
 * a workspace-less reviewer is the denied case; the owner check is written against
 * the role pivot so it stays correct the day team workspaces add Member seats.
 */
class WorkspacePolicy
{
    /**
     * Rename a workspace / edit its slug. Owner-only, and only for a workspace the
     * user actually belongs to as owner — a fresh (id-less) workspace or one the
     * user does not own both deny.
     */
    public function update(User $user, Workspace $workspace): bool
    {
        return $user->workspaces()
            ->whereKey($workspace->id)
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->exists();
    }
}
