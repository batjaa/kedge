<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;
use App\Policies\Concerns\ResolvesShareReviewers;

class ThreadPolicy
{
    use AuthorizesWorkspaceMembership;
    use ResolvesShareReviewers;

    public function viewAny(User $user, Document $document): bool
    {
        return $this->canViewThreads($user, $document);
    }

    public function create(User $user, Document $document): bool
    {
        return $this->canViewThreads($user, $document);
    }

    public function reply(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->canViewThreads($user, $thread->document);
    }

    public function triage(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->authorOf($user, $thread->document)
            || $this->ownsSubjectInReachableDocument($user, $thread->created_by, $thread->document);
    }
}
