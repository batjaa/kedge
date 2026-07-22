<?php

namespace App\Policies;

use App\Models\TrackedRepo;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * Tracked repos are reachable only within their workspace (SPEC §13, §16, user
 * story 19): an id in a URL is never an access path. Preview and create authorize
 * through {@see create}; the id-bound routes (show, scan) verify the actor belongs
 * to the row's workspace, so a foreign id is denied (403) — never confirmed to
 * exist. A workspace-less magic-link reviewer holds no personal workspace and is
 * refused 403 (never a 500), exactly as {@see ProjectPolicy} refuses.
 */
class TrackedRepoPolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * List a workspace's tracked repos. Personal-workspace holders only — a
     * workspace-less reviewer gets 403, never a 500.
     */
    public function viewAny(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Set up (preview / create) a tracked repo — it lands in the caller's own
     * personal workspace.
     */
    public function create(User $user): bool
    {
        return $this->hasPersonalWorkspace($user);
    }

    /**
     * Read a specific tracked repo (the scan poll target). Workspace members only;
     * a foreign id is never an access path.
     */
    public function view(User $user, TrackedRepo $trackedRepo): bool
    {
        return $this->memberOfWorkspace($user, $trackedRepo);
    }

    /**
     * Trigger a re-scan. Same scope as viewing — any member of the repo's own
     * workspace may re-scan; a foreign id is never an access path.
     */
    public function scan(User $user, TrackedRepo $trackedRepo): bool
    {
        return $this->memberOfWorkspace($user, $trackedRepo);
    }

    private function memberOfWorkspace(User $user, TrackedRepo $trackedRepo): bool
    {
        return $user->workspaces()
            ->whereKey($trackedRepo->workspace_id)
            ->exists();
    }
}
