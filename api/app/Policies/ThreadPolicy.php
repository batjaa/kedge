<?php

namespace App\Policies;

use App\Models\Thread;
use App\Models\User;

class ThreadPolicy
{
    public function reply(User $user, Thread $thread): bool
    {
        return $user->workspaces()
            ->whereKey($thread->document->workspace_id)
            ->exists();
    }
}
