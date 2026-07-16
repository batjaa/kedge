<?php

namespace App\Policies;

use App\Models\Comment;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;

class CommentPolicy
{
    use AuthorizesWorkspaceMembership;

    public function forkComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->authorOf($user, $comment->thread->document)
            || $this->ownedBy($user, $comment->thread->created_by);
    }

    public function updateComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownedBy($user, $comment->author_id)
            || $this->authorOf($user, $comment->thread->document);
    }

    public function deleteComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownedBy($user, $comment->author_id)
            || $this->authorOf($user, $comment->thread->document);
    }
}
