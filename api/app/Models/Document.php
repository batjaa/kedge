<?php

namespace App\Models;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use Database\Factories\DocumentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A document's stable identity within a workspace (SPEC 16). Its rendered
 * content lives on the {@see DocumentVersion} pointed to by
 * `current_version_id`; the import job (SPEC 5.3) drives `status` and, on
 * failure, `last_sync_status` + `sync_error`.
 */
#[Fillable([
    'workspace_id', 'integration_id', 'source_type', 'source_url', 'source_meta',
    'title', 'format', 'current_version_id', 'status', 'last_sync_status',
    'sync_error', 'lifecycle_status', 'expires_at', 'created_by',
])]
class Document extends Model
{
    /** @use HasFactory<DocumentFactory> */
    use HasFactory;

    /**
     * In-memory defaults that mirror the migration's column defaults, so a
     * freshly created model (before a DB round-trip) already carries its enum
     * columns — the import response is serialized straight from it.
     *
     * @var array<string, string>
     */
    protected $attributes = [
        'status' => 'importing',
        'last_sync_status' => 'ok',
        'lifecycle_status' => 'draft',
        'format' => 'md',
    ];

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return HasMany<DocumentVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class);
    }

    /**
     * The version currently rendered. Not a FK (the constraint would be circular
     * with document_versions.document_id) — just a pointer resolved by id.
     */
    public function currentVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class, 'current_version_id');
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source_type' => SourceType::class,
            'source_meta' => 'array',
            'format' => DocumentFormat::class,
            'status' => DocumentStatus::class,
            'last_sync_status' => SyncStatus::class,
            'lifecycle_status' => LifecycleStatus::class,
            'expires_at' => 'datetime',
        ];
    }
}
