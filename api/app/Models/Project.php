<?php

namespace App\Models;

use App\Policies\ProjectPolicy;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

/**
 * A project (SPEC §16, M3.6): a free container inside a workspace for what a
 * team is working on. Reachable only within its workspace — an id in a URL is
 * never an access path (the {@see ProjectPolicy} + the
 * controller's workspace scoping both enforce it). Documents attach to at most
 * one project and move freely; the absence of a project is Unfiled, not a row.
 */
#[Fillable(['workspace_id', 'name', 'slug', 'description', 'created_by'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory;

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The documents filed under this project (SPEC §16). Moving a doc out clears
     * its `project_id`; the project never owns content, only groups it.
     *
     * @return HasMany<Document, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(Document::class);
    }

    /**
     * Threads on this project's documents (SPEC §16, decision 7A). A count-only
     * read-through the dashboard rail's per-project open/orphaned counts ride via
     * a `withCount` (#104): each count constrains this relation with the ONE
     * shared Thread predicate — {@see Thread::scopeOpen()} / {@see Thread::scopeOrphaned()}
     * — never a re-encoded one, so a rail count can never drift from what the
     * summary and list report. Threads carry no `project_id`; they reach a project
     * only through their document, exactly this join.
     *
     * @return HasManyThrough<Thread, Document, $this>
     */
    public function threads(): HasManyThrough
    {
        return $this->hasManyThrough(Thread::class, Document::class);
    }
}
