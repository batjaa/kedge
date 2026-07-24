<?php

namespace App\Enums;

use App\Models\Document;
use Illuminate\Database\Eloquent\Builder;

/**
 * The dashboard's lifecycle filter chips (SPEC §16, M3.7): `all`, the three
 * editorial states a chip surfaces, and the `needs_attention` composite. This
 * enum is the ONE place a chip value maps to its document predicate (decision
 * 7A) — the workspace summary counts each state through {@see apply()} and the
 * documents list (M3.8, #103) filters through the same method, so a chip count
 * can never drift from the rows it narrows to. Amends SPEC §16's old "no
 * ?status=" note: the lifecycle filter is a server-side list parameter.
 */
enum DocumentLifecycleFilter: string
{
    case All = 'all';
    case Draft = 'draft';
    case InReview = 'in_review';
    case Approved = 'approved';
    case NeedsAttention = 'needs_attention';

    /**
     * Narrow a documents query to this filter. `all` is the identity (the caller
     * has already workspace-scoped it); the lifecycle cases defer to
     * {@see Document::scopeWithLifecycle()} and `needs_attention` to
     * {@see Document::scopeNeedsAttention()} — never a re-encoded predicate.
     *
     * @param  Builder<Document>  $query
     * @return Builder<Document>
     */
    public function apply(Builder $query): Builder
    {
        return match ($this) {
            self::All => $query,
            self::Draft => $query->withLifecycle(LifecycleStatus::Draft),
            self::InReview => $query->withLifecycle(LifecycleStatus::InReview),
            self::Approved => $query->withLifecycle(LifecycleStatus::Approved),
            self::NeedsAttention => $query->needsAttention(),
        };
    }
}
