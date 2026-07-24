<?php

namespace App\Models;

use Database\Factories\ApprovalFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Version-pinned reviewer sign-off (SPEC §9). Active approvals have
 * `revoked_at = null`; staleness is derived against the document's current
 * version at read time, never written onto this row.
 */
#[Fillable(['workspace_id', 'document_id', 'document_version_id', 'user_id', 'revoked_at'])]
class Approval extends Model
{
    /** @use HasFactory<ApprovalFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function documentVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function staleFor(Document $document): bool
    {
        return $document->current_version_id !== null
            && (int) $this->document_version_id !== (int) $document->current_version_id;
    }

    /**
     * Approvals still in force — never revoked. The set staleness is derived
     * against; the summary's stale count and the needs-attention predicate both
     * start here so "active" is defined once.
     *
     * @param  Builder<Approval>  $query
     * @return Builder<Approval>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('approvals.revoked_at');
    }

    /**
     * Approvals pinned to a version other than their document's current one — the
     * SQL twin of {@see staleFor()} (7A). The one definition of "stale approval":
     * the summary's stale count and the document needs-attention predicate both
     * reach it. `stale_docs` is a fresh alias so it composes both standalone and
     * nested inside a `documents` outer query without a table clash.
     *
     * @param  Builder<Approval>  $query
     * @return Builder<Approval>
     */
    public function scopeStale(Builder $query): Builder
    {
        return $query->whereExists(function ($sub): void {
            $sub->selectRaw('1')
                ->from('documents as stale_docs')
                ->whereColumn('stale_docs.id', 'approvals.document_id')
                ->whereNotNull('stale_docs.current_version_id')
                ->whereColumn('approvals.document_version_id', '!=', 'stale_docs.current_version_id');
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
