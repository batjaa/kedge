<?php

namespace App\Enums;

/**
 * A document version's place in the lineage. M3 only creates mainline versions;
 * candidates are reserved for the PR connector path (ADR 0001).
 */
enum VersionKind: string
{
    case Mainline = 'mainline';
    case Candidate = 'candidate';
}
