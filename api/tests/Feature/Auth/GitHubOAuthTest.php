<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Models\Workspace;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Contracts\User as SocialiteUser;
use Laravel\Socialite\Facades\Socialite;
use Mockery;
use Tests\TestCase;

/**
 * External behavior of the GitHub sign-in flow (ticket #6). Socialite is faked
 * at the provider boundary — no network, no real github.com — so the tests
 * exercise our create-or-link logic, the atomic side-effects, the verified-
 * email security rule, and the configured/unconfigured gate.
 */
class GitHubOAuthTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Turn the feature on: both credentials present ⇒ routes live, capability true.
     */
    private function enableGitHub(): void
    {
        config([
            'services.github.client_id' => 'test-client-id',
            'services.github.client_secret' => 'test-client-secret',
            'services.github.redirect' => 'http://localhost:8000/auth/github/callback',
        ]);
    }

    /**
     * Fake what Socialite hands back from github.com for one callback.
     */
    private function fakeGitHubUser(array $attributes): void
    {
        $user = Mockery::mock(SocialiteUser::class);
        $user->allows([
            'getId' => $attributes['id'] ?? '900001',
            'getEmail' => $attributes['email'] ?? null,
            'getName' => $attributes['name'] ?? null,
            'getNickname' => $attributes['nickname'] ?? null,
            'getAvatar' => $attributes['avatar'] ?? null,
        ]);

        $provider = Mockery::mock(Provider::class);
        $provider->allows('user')->andReturns($user);

        Socialite::shouldReceive('driver')->with('github')->andReturns($provider);
    }

    public function test_redirect_endpoint_sends_the_browser_to_github_with_correct_params(): void
    {
        $this->enableGitHub();

        $response = $this->get('/auth/github/redirect');

        $response->assertRedirect();
        $location = $response->headers->get('Location');

        $this->assertStringContainsString('https://github.com/login/oauth/authorize', $location);
        $this->assertStringContainsString('client_id=test-client-id', $location);
        $this->assertStringContainsString('redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fauth%2Fgithub%2Fcallback', $location);
        $this->assertStringContainsString('scope=user%3Aemail', $location);
    }

    public function test_first_time_sign_in_creates_user_workspace_membership_and_audit_atomically(): void
    {
        $this->enableGitHub();
        $this->fakeGitHubUser([
            'id' => '424242',
            'email' => 'ada@example.com',
            'name' => 'Ada Lovelace',
            'nickname' => 'ada',
            'avatar' => 'https://avatars.githubusercontent.com/u/424242',
        ]);

        $response = $this->get('/auth/github/callback?code=stub&state=stub');

        $response->assertRedirect('http://localhost:3000/');
        $this->assertAuthenticated();

        $user = User::firstWhere('email', 'ada@example.com');
        $this->assertNotNull($user);
        $this->assertSame('424242', $user->github_id);
        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertSame('https://avatars.githubusercontent.com/u/424242', $user->avatar_url);
        $this->assertNull($user->password, 'OAuth-only accounts have no password');
        $this->assertAuthenticatedAs($user);

        $workspace = $user->personalWorkspace();
        $this->assertNotNull($workspace);
        $this->assertDatabaseHas('workspace_members', [
            'workspace_id' => $workspace->id,
            'user_id' => $user->id,
            'role' => 'owner',
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspace->id,
            'user_id' => $user->id,
            'action' => 'user.registered',
            'subject_type' => User::class,
            'subject_id' => $user->id,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspace->id,
            'action' => 'workspace.created',
            'subject_type' => Workspace::class,
            'subject_id' => $workspace->id,
        ]);
    }

    public function test_sign_in_links_to_existing_account_by_verified_email(): void
    {
        // A real prior account: registered the email+password way, so it
        // already owns a personal workspace (the linking audit lands there).
        $existing = app(RegistrationService::class)->register(
            name: 'Grace Hopper',
            email: 'grace@example.com',
            password: 'correct-horse-battery',
        );
        $workspaceCountBefore = Workspace::count();

        $this->enableGitHub();
        $this->fakeGitHubUser([
            'id' => '135790',
            'email' => 'grace@example.com',
            'name' => 'Grace Hopper',
            'nickname' => 'grace',
            'avatar' => 'https://avatars.githubusercontent.com/u/135790',
        ]);

        $response = $this->get('/auth/github/callback?code=stub&state=stub');

        $response->assertRedirect('http://localhost:3000/');

        // One account, not two: the identity attached to the existing user.
        $this->assertDatabaseCount('users', 1);
        $this->assertSame($workspaceCountBefore, Workspace::count(), 'linking must not spin up a second workspace');

        $existing->refresh();
        $this->assertSame('135790', $existing->github_id);
        $this->assertAuthenticatedAs($existing);

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $existing->id,
            'action' => 'user.github_linked',
            'subject_type' => User::class,
            'subject_id' => $existing->id,
        ]);
    }

    public function test_returning_github_user_signs_in_without_duplicating(): void
    {
        $existing = User::factory()->create([
            'email' => 'linus@example.com',
            'github_id' => '111222',
        ]);

        $this->enableGitHub();
        // GitHub may report a different/private email on a later sign-in; the
        // github_id is the stable key, so we match on it and never duplicate.
        $this->fakeGitHubUser([
            'id' => '111222',
            'email' => 'linus-noreply@users.github.com',
            'name' => 'Linus',
            'nickname' => 'linus',
        ]);

        $response = $this->get('/auth/github/callback?code=stub&state=stub');

        $response->assertRedirect('http://localhost:3000/');
        $this->assertDatabaseCount('users', 1);
        $this->assertAuthenticatedAs($existing);
    }

    public function test_callback_refuses_to_link_without_a_verified_email(): void
    {
        // Account-takeover guard: an attacker's GitHub account whose primary
        // email is NOT verified yields getEmail() === null from Socialite. We
        // must not link it to — or authenticate as — the victim.
        $victim = User::factory()->create([
            'email' => 'victim@example.com',
            'github_id' => null,
        ]);

        $this->enableGitHub();
        $this->fakeGitHubUser([
            'id' => '666',
            'email' => null,
            'name' => 'Mallory',
            'nickname' => 'mallory',
        ]);

        $response = $this->get('/auth/github/callback?code=stub&state=stub');

        $response->assertRedirect('http://localhost:3000/signin?error=github_no_verified_email');
        $this->assertGuest();

        $victim->refresh();
        $this->assertNull($victim->github_id, 'victim account must be untouched');
        $this->assertDatabaseCount('users', 1); // no account created without a verified email
    }

    public function test_oauth_routes_are_absent_when_unconfigured(): void
    {
        // No credentials configured (the default): the feature hides, not breaks.
        $this->get('/auth/github/redirect')->assertNotFound();
        $this->get('/auth/github/callback')->assertNotFound();
    }

    public function test_capability_endpoint_reports_github_disabled_by_default(): void
    {
        // The surface is booleans only, no secrets. `self_hosted` was added with
        // demo mode (#25) — the web reads it to pick the anonymous home surface;
        // `ai.enabled` with the BYO-key AI gate (M4, #130); `mcp.enabled` with the
        // MCP server (M4, #135), reported separately because the two M4 gates are
        // independent — MCP is on by default and stays on with no Anthropic key.
        $this->getJson('/api/v1/config')
            ->assertOk()
            ->assertExactJson([
                'auth' => ['github' => false],
                'self_hosted' => false,
                'ai' => ['enabled' => false],
                'mcp' => ['enabled' => true],
            ]);
    }

    public function test_capability_endpoint_reports_github_enabled_when_configured(): void
    {
        $this->enableGitHub();

        $this->getJson('/api/v1/config')
            ->assertOk()
            ->assertJsonPath('auth.github', true);
    }

    public function test_oauth_redirect_shares_the_auth_rate_limiter(): void
    {
        $this->enableGitHub();

        // The shared per-IP "auth" bucket (10/min) spans register/login/logout
        // and the OAuth routes; the 11th request in the window trips 429.
        for ($i = 0; $i < 10; $i++) {
            $this->get('/auth/github/redirect')->assertRedirect();
        }

        $this->get('/auth/github/redirect')->assertTooManyRequests();
    }
}
