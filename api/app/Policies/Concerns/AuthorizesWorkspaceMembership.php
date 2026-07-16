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
        return $this->ownedBy($user, $document->created_by);
    }

    protected function ownerOf(User $user, Document $document): bool
    {
        return $user->workspaces()
            ->whereKey($document->workspace_id)
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->exists();
    }

    protected function ownedBy(User $user, mixed $userId): bool
    {
        return $userId !== null && (int) $userId === (int) $user->id;
    }
}
