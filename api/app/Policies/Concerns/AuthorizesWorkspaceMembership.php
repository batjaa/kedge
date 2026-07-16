<?php

namespace App\Policies\Concerns;

use App\Enums\WorkspaceRole;
use App\Models\Document;
use App\Models\ShareParticipant;
use App\Models\User;

trait AuthorizesWorkspaceMembership
{
    protected function memberOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->exists();
    }

    protected function authorOf(User $user, Document $document): bool
    {
        return $this->ownedBy($user, $document->created_by);
    }

    protected function ownerOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->exists();
    }

    protected function reviewerOf(User $user, Document $document): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $user->id)
            ->whereNotNull('verified_at')
            ->whereHas('share', function ($query) use ($document): void {
                $query->where('document_id', $document->id)
                    ->whereNull('revoked_at')
                    ->where(function ($query): void {
                        $query->whereNull('expires_at')
                            ->orWhere('expires_at', '>', now());
                    });
            })
            ->exists();
    }

    protected function canReadAndComment(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document)
            || $this->reviewerOf($user, $document);
    }

    protected function ownsInReachableDocument(User $user, mixed $userId, Document $document): bool
    {
        if (! $this->ownedBy($user, $userId)) {
            return false;
        }

        if (! $this->hasReviewerIdentity($user)) {
            return true;
        }

        return $this->canReadAndComment($user, $document);
    }

    protected function hasPersonalWorkspace(User $user): bool
    {
        return $user->personalWorkspace() !== null;
    }

    private function hasReviewerIdentity(User $user): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $user->id)
            ->exists();
    }

    protected function ownedBy(User $user, mixed $userId): bool
    {
        return $userId !== null && (int) $userId === (int) $user->id;
    }
}
