<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\User;

/**
 * Documents are reachable only within their workspace (SPEC 13, user story 21):
 * an id in a URL is never an access path. Every document route authorizes
 * through here — no inline ownership checks in controllers.
 */
class DocumentPolicy
{
    /**
     * Read the document (poll status, render). Workspace members only.
     */
    public function view(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }

    /**
     * Import a new document. Any authenticated user may — it lands in their own
     * personal workspace (M1 tenancy is invisible).
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * Mutate the document — today, retry a failed import. Workspace members only.
     */
    public function update(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }

    private function memberOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->exists();
    }
}
