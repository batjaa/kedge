<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

/**
 * External behavior of POST /login (Sanctum SPA cookie flow).
 */
class LoginTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_with_valid_credentials_issues_a_session(): void
    {
        $this->registerAda();

        $response = $this->postJson('/login', [
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);

        $response
            ->assertOk()
            ->assertCookie(config('session.cookie'))
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email', 'avatar_url'],
                'workspace' => ['id', 'name', 'slug'],
            ])
            ->assertJsonPath('user.email', 'ada@example.com');

        $this->assertAuthenticated();
    }

    public function test_login_issues_a_persistent_remember_cookie(): void
    {
        $ada = $this->registerAda();

        $response = $this->postJson('/login', [
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);

        // The recaller cookie outlives the short session, so an idle browser
        // is silently re-authenticated instead of bounced to sign-in.
        $response->assertOk()->assertCookie(Auth::guard('web')->getRecallerName());

        $this->assertNotNull($ada->fresh()->remember_token);
    }

    public function test_login_with_wrong_password_fails_with_a_clear_error(): void
    {
        $this->registerAda();

        $response = $this->postJson('/login', [
            'email' => 'ada@example.com',
            'password' => 'not-the-password',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);

        $this->assertGuest();
    }

    public function test_login_with_unknown_email_fails_without_leaking_existence(): void
    {
        $response = $this->postJson('/login', [
            'email' => 'nobody@example.com',
            'password' => 'whatever-it-takes',
        ]);

        // Same error as a wrong password: no account enumeration.
        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);

        $this->assertGuest();
    }

    public function test_oauth_only_accounts_cannot_password_login(): void
    {
        // OAuth-only accounts (ticket #6) have a null password.
        User::factory()->create([
            'email' => 'oauth-only@example.com',
            'password' => null,
        ]);

        $response = $this->postJson('/login', [
            'email' => 'oauth-only@example.com',
            'password' => 'any-guess-at-all',
        ]);

        $response->assertUnprocessable();

        $this->assertGuest();
    }

    private function registerAda(): User
    {
        return app(RegistrationService::class)->register(
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            password: 'correct-horse-battery',
        );
    }
}
