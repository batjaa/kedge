<?php

namespace App\Policies;

use App\Models\Comment;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;
use App\Policies\Concerns\ResolvesShareReviewers;

class CommentPolicy
{
    use AuthorizesWorkspaceMembership;
    use ResolvesShareReviewers;

    public function forkComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->authorOf($user, $comment->thread->document)
            || $this->ownsSubjectInReachableDocument($user, $comment->thread->created_by, $comment->thread->document);
    }

    public function updateComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownsSubjectInReachableDocument($user, $comment->author_id, $comment->thread->document)
            || $this->authorOf($user, $comment->thread->document);
    }

    public function deleteComment(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->ownsSubjectInReachableDocument($user, $comment->author_id, $comment->thread->document)
            || $this->authorOf($user, $comment->thread->document);
    }

    public function resolveSuggestion(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->authorOf($user, $comment->thread->document);
    }

    public function react(User $user, Comment $comment): bool
    {
        $comment->loadMissing('thread.document');

        return $this->canViewThreads($user, $comment->thread->document);
    }
}
