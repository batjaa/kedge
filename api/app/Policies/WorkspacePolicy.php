<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * The workspace itself as a resource (SPEC §10.1, §16). Like the documents list,
 * the dashboard summary is a personal-workspace read: only a user who holds one
 * may see it, and a magic-link reviewer (who holds none) is refused 403, never a
 * 500. The controller separately scopes every count to the caller's own
 * workspace, so authorization and the scope are both explicit — an id is never
 * an access path.
 */
class WorkspacePolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * Read the workspace's dashboard summary (SPEC §16, M3.7 — the stats strip
     * and filter-chip counts). Mirrors {@see DocumentPolicy::viewAny()}.
     */
    public function viewSummary(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }
}
