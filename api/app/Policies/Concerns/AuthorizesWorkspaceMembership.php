<?php

namespace App\Policies\Concerns;

use App\Models\Document;
use App\Models\User;

trait AuthorizesWorkspaceMembership
{
    protected function memberOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->exists();
    }
}
