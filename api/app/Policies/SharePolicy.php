<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\Share;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

/**
 * Managing a document's share links is a workspace-member action (SPEC 10.2,
 * 13): only members of the owning workspace may list, create, or revoke shares.
 * An id in a URL is never an access path — every share route authorizes here.
 *
 * The *public* read surface is not governed by this policy: there the token is
 * the capability, resolved without a user (see SharedDocumentController).
 */
class SharePolicy
{
    use AuthorizesWorkspaceMembership;

    /**
     * List a document's shares. Passed the parent document (Gate forwards the
     * extra argument after the class name).
     */
    public function viewAny(User $user, Document $document): bool
    {
        return $this->memberOfWorkspace($user, $document->workspace_id);
    }

    /**
     * Create a share for a document.
     */
    public function create(User $user, Document $document): bool
    {
        return $this->memberOfWorkspace($user, $document->workspace_id);
    }

    /**
     * Revoke a share.
     */
    public function delete(User $user, Share $share): bool
    {
        return $this->memberOfWorkspace($user, $share->document->workspace_id);
    }
}
