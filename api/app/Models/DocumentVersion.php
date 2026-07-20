<?php

namespace App\Models;

use App\Enums\VersionKind;
use Database\Factories\DocumentVersionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An immutable content snapshot of a document (SPEC 16, 5.2). Created once per
 * distinct `content_hash` per document — the unique constraint makes identical
 * re-imports dedupe onto the existing row.
 */
#[Fillable([
    'document_id', 'kind', 'parent_version_id', 'content_raw', 'content_normalized', 'plain_text',
    'projection_version', 'mdx_ok', 'import_warnings', 'content_hash',
    'source_version', 'synced_at',
])]
class DocumentVersion extends Model
{
    /** @use HasFactory<DocumentVersionFactory> */
    use HasFactory;

    /**
     * Mirror the DB default so newly-created versions serialize consistently
     * before a reload.
     *
     * @var array<string, string>
     */
    protected $attributes = [
        'kind' => 'mainline',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function parentVersion(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_version_id');
    }

    /**
     * M3 only has mainline versions, so lineage order is creation/id order. The
     * named scope gives candidate insertion a single ordering seam later.
     *
     * @param  Builder<DocumentVersion>  $query
     * @return Builder<DocumentVersion>
     */
    public function scopeLineageOrdered(Builder $query): Builder
    {
        return $query->orderBy('id');
    }

    /** @return HasMany<Anchor, $this> */
    public function anchors(): HasMany
    {
        return $this->hasMany(Anchor::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => VersionKind::class,
            'import_warnings' => 'array',
            'mdx_ok' => 'boolean',
            'synced_at' => 'datetime',
        ];
    }
}
