<?php

namespace App\Enums;

/**
 * Editorial state of a document (SPEC 16). The column exists from M1 with a
 * default of `draft`; the transitions and their UI (in-review → approved →
 * superseded) arrive at M3. Nothing writes anything but the default yet.
 */
enum LifecycleStatus: string
{
    case Draft = 'draft';
    case InReview = 'in_review';
    case Approved = 'approved';
    case Superseded = 'superseded';
}
