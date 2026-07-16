<?php

namespace App\Models;

use App\Enums\CommentClient;
use App\Enums\CommentType;
use App\Enums\SuggestionStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'thread_id', 'author_id', 'type', 'body_md', 'proposed_text',
    'suggestion_status', 'client', 'edited_at', 'idempotency_key',
    'idempotency_scope', 'idempotency_scope_id',
])]
class Comment extends Model
{
    use SoftDeletes;

    protected $attributes = [
        'type' => 'comment',
        'client' => 'web',
    ];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(Thread::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    protected function casts(): array
    {
        return [
            'type' => CommentType::class,
            'suggestion_status' => SuggestionStatus::class,
            'client' => CommentClient::class,
            'edited_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }
}
