<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\WorkspaceRole;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Sanctum\PersonalAccessToken;

#[Fillable(['name', 'email', 'avatar_url', 'github_id', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The workspaces the user is a member of.
     */
    public function workspaces(): BelongsToMany
    {
        return $this->belongsToMany(Workspace::class, 'workspace_members')
            ->using(WorkspaceMember::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    /**
     * The user's personal workspace — auto-created at registration (SPEC 10.1).
     *
     * v1 tenancy is invisible: every user owns exactly one workspace, so the
     * first owned workspace is the personal one.
     */
    public function personalWorkspace(): ?Workspace
    {
        return $this->workspaces()
            ->wherePivot('role', WorkspaceRole::Owner->value)
            ->orderBy('workspaces.id')
            ->first();
    }

    /** @return HasMany<ShareParticipant, $this> */
    public function shareParticipations(): HasMany
    {
        return $this->hasMany(ShareParticipant::class);
    }

    /**
     * True when this request authenticated with a real agent token rather than
     * the first-party session cookie (which carries a TransientToken).
     *
     * The one place that distinction is named — every caller that needs to know
     * "is the actor an agent?" asks here rather than re-deriving it.
     */
    public function usingAgentToken(): bool
    {
        return $this->currentAccessToken() instanceof PersonalAccessToken;
    }

    public function isPureReviewer(): bool
    {
        return $this->password === null
            && $this->github_id === null
            && ! $this->workspaces()->exists();
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }
}
