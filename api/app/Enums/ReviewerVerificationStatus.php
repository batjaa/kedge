<?php

namespace App\Enums;

enum ReviewerVerificationStatus: string
{
    case Verified = 'verified';
    case PendingCompletion = 'pending_completion';
    case Expired = 'expired';
    case Used = 'used';
    case Invalid = 'invalid';
    case AccountRequired = 'account_required';
}
