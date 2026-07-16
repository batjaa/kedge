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
            || $this->ownsInReachableDocument($user, $comment->thread->created_by, $comment->thread->document);
    }

    public function updateComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownsInReachableDocument($user, $comment->author_id, $comment->thread->document)
            || $this->authorOf($user, $comment->thread->document);
    }

    public function deleteComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownsInReachableDocument($user, $comment->author_id, $comment->thread->document)
            || $this->authorOf($user, $comment->thread->document);
    }

    public function resolveSuggestion(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->authorOf($user, $comment->thread->document);
    }
}
