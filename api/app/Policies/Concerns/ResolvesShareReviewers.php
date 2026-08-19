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

    /**
     * Own-subject reach: whoever created a thread or comment may manage it.
     *
     * For a reviewer identity that reach is bounded by the share (a reviewer must
     * still be able to see the document); M2 deliberately leaves it unbounded for
     * everyone else, so a document author or thread creator who holds no
     * workspace membership can still moderate what they started — see
     * ThreadCommentTest's non-member author/creator cases.
     *
     * An agent token is bounded regardless. Its owner's authorship is not a way
     * around workspace scope: the credential must name this document's workspace.
     */
    protected function ownsSubjectInReachableDocument(User $user, mixed $userId, Document $document): bool
    {
        if (! $this->ownedBy($user, $userId)) {
            return false;
        }

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
