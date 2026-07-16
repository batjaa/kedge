<?php

namespace App\Models;

use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['document_id', 'type', 'status', 'forked_from_comment_id', 'created_by'])]
class Thread extends Model
{
    protected $attributes = [
        'type' => 'inline',
        'status' => 'open',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function forkedFromComment(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'forked_from_comment_id')->withTrashed();
    }

    /** @return HasMany<Comment, $this> */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class)->withTrashed();
    }

    /** @return HasMany<Anchor, $this> */
    public function anchors(): HasMany
    {
        return $this->hasMany(Anchor::class);
    }

    public function firstComment(): HasOne
    {
        return $this->hasOne(Comment::class)->withTrashed()->oldestOfMany();
    }

    /** @return HasManyThrough<Thread, Comment, $this> */
    public function forkedIntoThreads(): HasManyThrough
    {
        return $this->hasManyThrough(
            Thread::class,
            Comment::class,
            'thread_id',
            'forked_from_comment_id',
            'id',
            'id',
        );
    }

    protected function casts(): array
    {
        return [
            'type' => ThreadType::class,
            'status' => ThreadStatus::class,
        ];
    }
}
