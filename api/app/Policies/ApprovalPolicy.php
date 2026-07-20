<?php

namespace App\Policies;

use App\Models\Approval;
use App\Models\Document;
use App\Models\User;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;
use App\Policies\Concerns\ResolvesShareReviewers;

class ApprovalPolicy
{
    use AuthorizesWorkspaceMembership;
    use ResolvesShareReviewers;

    public function approve(User $user, Document $document): bool
    {
        return $this->canViewThreads($user, $document);
    }

    public function revoke(User $user, Approval $approval): bool
    {
        return $this->ownedBy($user, $approval->user_id);
    }
}
