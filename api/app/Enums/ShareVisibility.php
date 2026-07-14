<?php

namespace App\Enums;

/**
 * Who a share link admits (SPEC 10.2). M1 ships `link` only — an unguessable
 * token is the sole capability. `email_restricted` and `workspace` need M2's
 * magic-link identity to know *who* is behind the link, so they arrive with it;
 * the column and this enum already carry the seam so that is an additive change,
 * not a schema migration.
 */
enum ShareVisibility: string
{
    case Link = 'link';
}
