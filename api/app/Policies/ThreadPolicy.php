<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

class ThreadPolicy
{
    use AuthorizesWorkspaceMembership;

    public function viewAny(User $user, Document $document): bool
    {
        return $this->canReadAndComment($user, $document);
    }

    public function create(User $user, Document $document): bool
    {
        return $this->canReadAndComment($user, $document);
    }

    public function reply(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->canReadAndComment($user, $thread->document);
    }

    public function triage(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->authorOf($user, $thread->document)
            || $this->ownsInReachableDocument($user, $thread->created_by, $thread->document);
    }
}
