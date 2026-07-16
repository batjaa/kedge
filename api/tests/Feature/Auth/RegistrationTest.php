<?php

namespace Tests\Feature\Auth;

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * External behavior of POST /register (Sanctum SPA cookie flow):
 * status codes, cookie issuance, JSON shape, and atomic DB side-effects.
 */
class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @var array<string, string>
     */
    private array $payload = [
        'name' => 'Ada Lovelace',
        'email' => 'ada@example.com',
        'password' => 'correct-horse-battery',
    ];

    public function test_registration_creates_account_with_personal_workspace_and_session(): void
    {
        $response = $this->postJson('/register', $this->payload);

        $response
            ->assertCreated()
            ->assertCookie(config('session.cookie'))
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email', 'avatar_url'],
                'workspace' => ['id', 'name', 'slug'],
            ])
            ->assertJsonPath('user.name', 'Ada Lovelace')
            ->assertJsonPath('user.email', 'ada@example.com');

        $this->assertAuthenticated();

        $user = User::firstWhere('email', 'ada@example.com');
        $workspace = Workspace::firstWhere('slug', $response->json('workspace.slug'));

        $this->assertNotNull($user);
        $this->assertNotNull($workspace);
        $this->assertNull($user->email_verified_at, 'M0 email+password accounts are unverified (spec: out of scope until M2)');

        $this->assertDatabaseHas('workspace_members', [
            'workspace_id' => $workspace->id,
            'user_id' => $user->id,
            'role' => WorkspaceRole::Owner->value,
        ]);
    }

    public function test_registration_writes_the_first_audit_log_entries(): void
    {
        $response = $this->postJson('/register', $this->payload);

        $response->assertCreated();

        $user = User::firstWhere('email', 'ada@example.com');
        $workspaceId = $response->json('workspace.id');

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspaceId,
            'user_id' => $user->id,
            'action' => 'user.registered',
            'subject_type' => User::class,
            'subject_id' => $user->id,
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspaceId,
            'user_id' => $user->id,
            'action' => 'workspace.created',
            'subject_type' => Workspace::class,
            'subject_id' => $workspaceId,
        ]);
    }

    public function test_registration_is_atomic_and_rolls_back_completely_on_failure(): void
    {
        // Force the last write inside the transaction to fail: without the
        // audit_logs table, registration must leave nothing behind.
        Schema::drop('audit_logs');

        $response = $this->postJson('/register', $this->payload);

        $response->assertServerError();

        $this->assertGuest();
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('workspaces', 0);
        $this->assertDatabaseCount('workspace_members', 0);
    }

    public function test_duplicate_email_is_rejected_with_a_clear_error(): void
    {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/register', $this->payload);

        $response
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'An account with this email already exists.');

        $this->assertGuest();
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('workspaces', 0);
    }

    public function test_registration_upgrades_passwordless_non_member_reviewer_shadow_user(): void
    {
        $shadow = User::factory()->create([
            'name' => 'Ada Reviewer',
            'email' => 'ada@example.com',
            'github_id' => null,
            'password' => null,
            'email_verified_at' => now()->subMinute(),
        ]);

        $response = $this->postJson('/register', $this->payload);

        $response
            ->assertCreated()
            ->assertJsonPath('user.id', $shadow->id)
            ->assertJsonPath('user.name', 'Ada Lovelace');

        $this->assertAuthenticatedAs($shadow->fresh());
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('workspaces', 1);

        $shadow->refresh();
        $this->assertNotNull($shadow->password);
        $this->assertNotNull($shadow->email_verified_at);

        $this->assertDatabaseHas('workspace_members', [
            'user_id' => $shadow->id,
            'role' => WorkspaceRole::Owner->value,
        ]);
    }

    public function test_registration_rejects_invalid_payloads(): void
    {
        $this->postJson('/register', [
            'name' => 'Ada Lovelace',
            'email' => 'not-an-email',
            'password' => 'short',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);

        $this->assertDatabaseCount('users', 0);
    }
}
