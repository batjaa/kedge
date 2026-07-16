<?php

namespace App\Policies\Concerns;

use App\Enums\WorkspaceRole;
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

    protected function authorOf(User $user, Document $document): bool
    {
        return $document->created_by !== null
            && (int) $document->created_by === (int) $user->id;
    }

    protected function ownerOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->exists();
    }
}
