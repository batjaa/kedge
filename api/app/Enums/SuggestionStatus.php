<?php

namespace App\Enums;

enum SuggestionStatus: string
{
    case Pending = 'pending';
    case Accepted = 'accepted';
    case Declined = 'declined';
}
