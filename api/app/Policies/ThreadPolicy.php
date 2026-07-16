<?php

namespace App\Policies;

use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

class ThreadPolicy
{
    use AuthorizesWorkspaceMembership;

    public function viewAny(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }

    public function create(User $user, Document $document): bool
    {
        return $this->memberOf($user, $document);
    }

    public function reply(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->memberOf($user, $thread->document);
    }

    public function triage(User $user, Thread $thread): bool
    {
        $thread->loadMissing('document');

        return $this->memberOf($user, $thread->document)
            && ($this->authorOf($user, $thread->document) || (int) $thread->created_by === (int) $user->id);
    }

    public function forkComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->triage($user, $comment->thread);
    }

    public function updateComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->memberOf($user, $comment->thread->document)
            && (int) $comment->author_id === (int) $user->id;
    }

    public function deleteComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');
        $document = $comment->thread->document;

        return $this->memberOf($user, $document)
            && (
                (int) $comment->author_id === (int) $user->id
                || $this->authorOf($user, $document)
                || $this->ownerOf($user, $document)
            );
    }
}
