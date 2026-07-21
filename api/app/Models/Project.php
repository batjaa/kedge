<?php

namespace App\Models;

use App\Policies\ProjectPolicy;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
}
