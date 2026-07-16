<?php

namespace App\Policies\Concerns;

use App\Models\Document;
use App\Models\ShareParticipant;
use App\Models\User;

trait ResolvesShareReviewers
{
    protected function reviewerOf(User $user, Document $document): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $user->id)
            ->whereNotNull('verified_at')
            ->whereHas('share', function ($query) use ($document): void {
                $query->where('document_id', $document->id)
                    ->active();
            })
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
