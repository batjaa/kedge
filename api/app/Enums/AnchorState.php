<?php

namespace App\Enums;

enum AnchorState: string
{
    case Anchored = 'anchored';
    case Relocated = 'relocated';
    case Orphaned = 'orphaned';
}
