<?php

namespace App\Models;

use App\Enums\IntegrationProvider;
use Database\Factories\WorkspaceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'settings'])]
class Workspace extends Model
{
    /** @use HasFactory<WorkspaceFactory> */
    use HasFactory;

    /**
     * The users that belong to the workspace.
     */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'workspace_members')
            ->using(WorkspaceMember::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    /**
     * The credentials this workspace holds for third-party sources (SPEC §16).
     *
     * @return HasMany<Integration, $this>
     */
    public function integrations(): HasMany
    {
        return $this->hasMany(Integration::class);
    }

    /**
     * The workspace's connected GitHub PAT, or null (#23). The single source of
     * truth for "does this workspace import GitHub authenticated" — the import
     * flow prefers the authenticated connector whenever this is non-null. The
     * latest wins, so reconnecting (a fresh token) supersedes an older one.
     */
    public function githubPatIntegration(): ?Integration
    {
        return $this->integrations()
            ->where('provider', IntegrationProvider::GithubPat)
            ->latest('id')
            ->first();
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'settings' => 'array',
        ];
    }
}
