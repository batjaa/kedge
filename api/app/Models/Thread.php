<?php

namespace App\Models;

use App\Enums\AnchorState;
use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
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

    /**
     * Threads still awaiting triage (SPEC §7). The single home for "open" — the
     * workspace summary's open-thread count and the home list's per-row count
     * read this one predicate, never a copied `where status`.
     *
     * @param  Builder<Thread>  $query
     * @return Builder<Thread>
     */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('threads.status', ThreadStatus::Open->value);
    }

    /**
     * Threads whose anchor on their document's *current* version came back
     * orphaned (SPEC §7.4, the re-anchor flow). The one definition of "orphaned"
     * (7A): the workspace summary's orphan count and the document-level
     * needs-attention predicate both reach it, so re-anchoring semantics live in
     * exactly one correlated sub-query. `orphan_docs` is a fresh alias so the
     * scope composes both standalone (Thread::query()) and nested inside a
     * `documents` outer query (Document::needsAttention) without a table clash.
     *
     * @param  Builder<Thread>  $query
     * @return Builder<Thread>
     */
    public function scopeOrphaned(Builder $query): Builder
    {
        return $query->whereExists(function ($sub): void {
            $sub->selectRaw('1')
                ->from('anchors')
                ->join('documents as orphan_docs', 'orphan_docs.id', '=', 'threads.document_id')
                ->whereColumn('anchors.thread_id', 'threads.id')
                ->whereColumn('anchors.document_version_id', 'orphan_docs.current_version_id')
                ->where('anchors.state', AnchorState::Orphaned->value);
        });
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
