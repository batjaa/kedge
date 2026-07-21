<?php

namespace App\Models;

use Database\Factories\ApprovalFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
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
