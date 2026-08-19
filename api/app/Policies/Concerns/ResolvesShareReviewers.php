<?php

namespace App\Policies\Concerns;

use App\Models\Document;
use App\Models\ShareParticipant;
use App\Models\User;

/**
 * Reviewer-via-share reach (SPEC §10.2). Always composed alongside
 * {@see AuthorizesWorkspaceMembership}, whose `tokenReachesWorkspace()` it
 * reuses: a share reviewership is still a workspace's document, so an agent
 * token that lacks that workspace's ability must not ride its owner's reviewer
 * identity into another workspace (m4-ai-agents eng review §2).
 */
trait ResolvesShareReviewers
{
    protected function reviewerOf(User $user, Document $document): bool
    {
        if (! $this->tokenReachesWorkspace($user, (int) $document->workspace_id)) {
            return false;
        }

        return ShareParticipant::query()
            ->where('user_id', $user->id)
            ->verifiedForActiveDocumentShare($document)
            ->exists();
    }

    protected function canViewThreads(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document)
            || $this->reviewerOf($user, $document);
    }

    protected function ownsSubjectInReachableDocument(User $user, mixed $userId, Document $document): bool
    {
        if (! $this->ownedBy($user, $userId)) {
            return false;
        }

        // Authoring something is not, on its own, workspace reach: an agent token
        // must still carry this document's workspace ability to touch its owner's
        // own comment or thread.
        if (! $this->tokenReachesWorkspace($user, (int) $document->workspace_id)) {
            return false;
        }

        if (! $this->hasReviewerIdentity($user)) {
            return true;
        }

        return $this->canViewThreads($user, $document);
    }

    private function hasReviewerIdentity(User $user): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $user->id)
            ->exists();
    }
}
