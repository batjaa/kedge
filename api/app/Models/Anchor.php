<?php

namespace App\Models;

use App\Enums\AnchorState;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'thread_id', 'document_version_id', 'exact', 'prefix', 'suffix',
    'start', 'end', 'heading_path', 'projection_version', 'state',
])]
class Anchor extends Model
{
    protected $attributes = [
        'state' => 'anchored',
    ];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(Thread::class);
    }

    public function documentVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class);
    }

    protected function casts(): array
    {
        return [
            'heading_path' => 'array',
            'state' => AnchorState::class,
        ];
    }
}
