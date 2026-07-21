<?php

namespace App\Policies;

use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * Tracked repos are reachable only within their workspace (SPEC §13, §16, user
 * story 19): an id in a URL is never an access path. Preview is the create
 * wizard's first step, so it authorizes through {@see create} — a
 * workspace-less magic-link reviewer holds no personal workspace and is refused
 * 403 (never a 500), exactly as {@see ProjectPolicy} refuses project creation.
 *
 * Only viewAny/create ship this milestone (preview is read-only, no persistence);
 * show/scan/delete arrive with the scan pipeline (#93).
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
}
