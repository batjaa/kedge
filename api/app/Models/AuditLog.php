<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * Append-only audit trail (SPEC 9, 10.1). Rows are created, never updated.
 */
#[Fillable(['workspace_id', 'user_id', 'action', 'subject_type', 'subject_id', 'meta', 'ip'])]
class AuditLog extends Model
{
    /**
     * Audit logs are append-only; there is no updated_at column.
     */
    public const UPDATED_AT = null;

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            // `action` stays a plain string on read: the write seam already
            // guarantees only AuditEvent values land here, and an un-cast column
            // lets an older reader tolerate a future action instead of throwing on
            // hydration (M3.8 #108). Resolve to the enum with AuditEvent::tryFrom().
            'meta' => 'array',
        ];
    }
}
