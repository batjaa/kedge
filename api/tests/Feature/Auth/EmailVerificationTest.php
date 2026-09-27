<?php

namespace Tests\Feature\Auth;

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use App\Notifications\WelcomeEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\SendQueuedNotifications;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_signup_sends_welcome_and_requires_confirmation_before_resource_access(): void
    {
        Notification::fake();
        $this->postJson('/register', [
            'name' => 'New Reviewer', 'email' => 'new@example.com', 'password' => 'new-password-123',
        ])->assertCreated()->assertJsonPath('email_verified', false);
        $user = User::firstWhere('email', 'new@example.com');
        Notification::assertSentTo($user, WelcomeEmail::class);
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('email_verified', false);
        $this->getJson('/api/v1/documents')->assertForbidden();
        $this->postJson('/api/v1/agent-tokens', [])->assertForbidden();

        $url = (new WelcomeEmail)->toMail($user)->actionUrl;
        $this->get($url)->assertRedirect(config('kedge.frontend_url').'/verify-email?status=verified');
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->actingAs($user->fresh())->getJson('/api/v1/documents')->assertOk();
        $this->get($url)->assertRedirect(config('kedge.frontend_url').'/verify-email?status=verified');
    }

    public function test_confirmation_works_without_session_but_does_not_log_in(): void
    {
        $user = User::factory()->unverified()->create();
        $this->get((new WelcomeEmail)->toMail($user)->actionUrl)
            ->assertRedirect(config('kedge.frontend_url').'/verify-email?status=verified');
        $this->assertTrue($user->fresh()->hasVerifiedEmail());
        $this->assertGuest();
    }

    public function test_existing_unverified_session_observes_confirmation_on_its_next_request(): void
    {
        $password = 'legacy-account-password';
        $user = User::factory()->unverified()->create(['password' => $password]);
        $workspace = Workspace::factory()->create();
        $workspace->members()->attach($user, ['role' => WorkspaceRole::Owner->value]);
        $this->postJson('/login', ['email' => $user->email, 'password' => $password])
            ->assertOk()
            ->assertJsonPath('email_verified', false);

        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('email_verified', false);
        $this->getJson('/api/v1/documents')->assertForbidden();

        // The signed link may be opened on another device, but this is the
        // original persisted session's next request after that confirmation.
        $this->get((new WelcomeEmail)->toMail($user)->actionUrl)
            ->assertRedirect(config('kedge.frontend_url').'/verify-email?status=verified');

        // A browser's next request resolves the session user anew; unlike
        // actingAs(), do not retain an in-memory model with the old timestamp.
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('email_verified', true);
        $this->getJson('/api/v1/documents')->assertOk();
    }

    public function test_expired_tampered_and_wrong_email_links_do_not_confirm(): void
    {
        $user = User::factory()->unverified()->create();
        $url = (new WelcomeEmail)->toMail($user)->actionUrl;
        $invalid = config('kedge.frontend_url').'/verify-email?status=invalid';
        $this->get($url.'tampered')->assertRedirect($invalid);
        $this->get(URL::temporarySignedRoute('verification.verify', now()->addHour(), [
            'id' => $user->id, 'hash' => sha1('other@example.com'),
        ]))->assertRedirect($invalid);
        $this->travel(61)->minutes();
        $this->get($url)->assertRedirect($invalid);
        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_resend_is_authenticated_throttled_and_skips_verified_accounts(): void
    {
        Notification::fake();
        $this->postJson('/email/verification-notification')->assertUnauthorized();
        $user = User::factory()->unverified()->create();
        $this->actingAs($user)->postJson('/email/verification-notification')->assertOk();
        Notification::assertSentToTimes($user, WelcomeEmail::class, 1);
        $this->postJson('/email/verification-notification')->assertTooManyRequests();
        $this->travel(61)->seconds();
        $user->markEmailAsVerified();
        $this->postJson('/email/verification-notification')->assertOk();
        Notification::assertSentToTimes($user, WelcomeEmail::class, 1);
    }

    public function test_mail_delivery_is_queued_after_commit(): void
    {
        Queue::fake();
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        Queue::assertPushed(SendQueuedNotifications::class, function ($job) {
            return $job->notification instanceof WelcomeEmail && $job->afterCommit;
        });
    }
}
