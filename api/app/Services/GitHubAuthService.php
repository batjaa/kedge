<?php

namespace App\Services;

use App\Enums\AuditEvent;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as SocialiteUser;

/**
 * Resolves a GitHub OAuth identity to a Kedge user — create, link, or return
 * the already-linked account (ticket #6). One account either way.
 *
 * SECURITY: linking to an existing account keys ONLY on GitHub's verified
 * primary email. Socialite's github driver requests the `user:email` scope and
 * its getEmailByToken() returns an address only when it is both primary AND
 * verified, so `$githubUser->getEmail()` is that trusted address (or null). The
 * caller must refuse the flow when it is null — linking on an unverified
 * profile email is an account-takeover vector.
 */
class GitHubAuthService
{
    public function __construct(
        private readonly RegistrationService $registration,
        private readonly AuditLogger $auditLogger,
    ) {}

    /**
     * True only when both OAuth credentials are present. Single source of truth
     * for "GitHub sign-in is on": the routes 404 without it and the public
     * capability endpoint reports it, so the two can never disagree.
     */
    public function isConfigured(): bool
    {
        return filled(config('services.github.client_id'))
            && filled(config('services.github.client_secret'));
    }

    /**
     * Map a verified GitHub identity to a Kedge user.
     *
     * @param  string  $verifiedEmail  GitHub's verified primary email (caller-checked, non-empty).
     */
    public function resolve(SocialiteUser $githubUser, string $verifiedEmail, ?string $ip = null): User
    {
        $githubId = (string) $githubUser->getId();

        // 1. Returning user — this GitHub account is already linked.
        if ($existing = User::firstWhere('github_id', $githubId)) {
            return $existing;
        }

        // 2. An account already owns this verified email → link the identity.
        if ($byEmail = User::firstWhere('email', $verifiedEmail)) {
            return $this->linkIdentity($byEmail, $githubUser, $githubId, $ip);
        }

        // 3. First-time sign-in → create through the same atomic path as email
        //    registration (user + personal workspace + owner membership + audit).
        return $this->registration->register(
            name: $this->displayName($githubUser, $verifiedEmail),
            email: $verifiedEmail,
            password: null,
            avatarUrl: $githubUser->getAvatar(),
            ip: $ip,
            githubId: $githubId,
        );
    }

    /**
     * Attach the GitHub identity to an existing account, atomically, and record
     * the link in the account's personal-workspace audit trail (SPEC 9).
     */
    private function linkIdentity(User $user, SocialiteUser $githubUser, string $githubId, ?string $ip): User
    {
        return DB::transaction(function () use ($user, $githubUser, $githubId, $ip): User {
            $user->forceFill([
                'github_id' => $githubId,
                // Backfill an avatar only if the account never had one.
                'avatar_url' => $user->avatar_url ?? $githubUser->getAvatar(),
            ])->save();

            if ($workspace = $user->personalWorkspace()) {
                $this->auditLogger->record($workspace, $user, AuditEvent::UserGithubLinked, $user, ip: $ip);
            }

            return $user;
        });
    }

    /**
     * GitHub's display name, falling back to the login handle, then the email
     * local part — a users table row must always have a name.
     */
    private function displayName(SocialiteUser $githubUser, string $verifiedEmail): string
    {
        return $githubUser->getName()
            ?: $githubUser->getNickname()
            ?: Str::before($verifiedEmail, '@');
    }
}
