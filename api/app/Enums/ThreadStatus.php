<?php

namespace App\Enums;

enum ThreadStatus: string
{
    case Open = 'open';
    case Resolved = 'resolved';
}
