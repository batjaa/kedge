<?php

namespace App\Services;

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates an account and its silently-provisioned personal workspace
 * (SPEC 10.1): user + workspace + owner membership + first audit-log
 * entries, atomically — or nothing.
 *
 * Both registration paths use this service: email+password (M0) and
 * GitHub OAuth (ticket #6, password null).
 */
class RegistrationService
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
    ) {}

    /**
     * Register a new account. Password is null for OAuth-only accounts;
     * githubId is set when the account is born from a GitHub sign-in, so the
     * provider identity is written inside the same transaction (ticket #6).
     */
    public function register(
        string $name,
        string $email,
        ?string $password,
        ?string $avatarUrl = null,
        ?string $ip = null,
        ?string $githubId = null,
    ): User {
        return DB::transaction(function () use ($name, $email, $password, $avatarUrl, $ip, $githubId): User {
            $user = User::create([
                'name' => $name,
                'email' => $email,
                'password' => $password,
                'avatar_url' => $avatarUrl,
                'github_id' => $githubId,
            ]);

            $workspace = Workspace::create([
                'name' => $name,
                'slug' => $this->uniqueSlug($name),
            ]);

            $workspace->members()->attach($user, [
                'role' => WorkspaceRole::Owner->value,
            ]);

            $this->auditLogger->record($workspace, $user, 'user.registered', $user, ip: $ip);
            $this->auditLogger->record($workspace, $user, 'workspace.created', $workspace, ip: $ip);

            return $user;
        });
    }

    /**
     * Derive a unique workspace slug from the user's name.
     */
    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name);
        $base = $base === '' ? 'workspace' : $base;
        $slug = $base;

        while (Workspace::where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(6));
        }

        return $slug;
    }
}
