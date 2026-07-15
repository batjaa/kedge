<?php

namespace App\Models;

use Database\Factories\DocumentVersionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An immutable content snapshot of a document (SPEC 16, 5.2). Created once per
 * distinct `content_hash` per document — the unique constraint makes identical
 * re-imports dedupe onto the existing row.
 */
#[Fillable([
    'document_id', 'content_raw', 'content_normalized', 'plain_text',
    'projection_version', 'import_warnings', 'content_hash', 'source_version',
    'synced_at',
])]
class DocumentVersion extends Model
{
    /** @use HasFactory<DocumentVersionFactory> */
    use HasFactory;

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'import_warnings' => 'array',
            'synced_at' => 'datetime',
        ];
    }
}
