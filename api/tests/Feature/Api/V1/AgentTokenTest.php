<?php

namespace Tests\Feature\Api\V1;

use App\Models\AgentToken;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Minting, listing, and revoking Agent Tokens from the settings surface (SPEC
 * §15, user story 12, #131).
 *
 * The lifecycle a member actually lives: name a token, see its value exactly
 * once, watch last-used move as the agent works, cut it off instantly.
 */
class AgentTokenTest extends TestCase
{
    use RefreshDatabase;

    private function member(string $email = 'operator@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Agent Operator',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    public function test_a_member_mints_a_named_token_and_sees_its_value_exactly_once(): void
    {
        $user = $this->member();

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->assertStatus(201)
            ->assertJsonPath('name', 'Claude Code')
            ->assertJsonPath('last_used_at', null);

        $value = $response->json('value');
        $this->assertIsString($value);
        $this->assertNotSame('', $value);

        // The listing can only ever show state — the value is unrecoverable.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/agent-tokens')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Claude Code')
            ->assertJsonMissingPath('data.0.value');
    }

    public function test_only_the_digest_of_a_token_is_ever_stored(): void
    {
        $user = $this->member();

        $value = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->json('value');

        [, $plainText] = explode('|', $value, 2);
        $stored = AgentToken::sole();

        $this->assertNotSame($plainText, $stored->token);
        $this->assertSame(hash('sha256', $plainText), $stored->token);
        $this->assertDatabaseMissing('personal_access_tokens', ['token' => $plainText]);
    }

    public function test_a_minted_token_is_scoped_to_the_minters_own_workspace(): void
    {
        $user = $this->member();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', [
                'name' => 'Claude Code',
                // A client-supplied scope is not part of the contract and must not
                // widen anything.
                'abilities' => ['*'],
            ])
            ->assertStatus(201);

        $token = AgentToken::sole();

        $this->assertSame(['workspace:'.$user->personalWorkspace()->id], $token->abilities);
        $this->assertTrue($token->scopedToWorkspace($user->personalWorkspace()->id));
        $this->assertFalse($token->scopedToWorkspace($user->personalWorkspace()->id + 1));
    }

    public function test_a_wildcard_ability_never_counts_as_workspace_scope(): void
    {
        $token = new AgentToken(['abilities' => ['*']]);

        $this->assertTrue($token->can('workspace:1'), 'Sanctum honours the wildcard');
        $this->assertFalse(
            $token->scopedToWorkspace(1),
            'A wildcard token is an unscoped one and must not pass workspace scoping',
        );
    }

    public function test_a_token_needs_a_name(): void
    {
        $user = $this->member();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');

        $this->assertSame(0, AgentToken::count());
    }

    public function test_the_list_shows_last_used_as_the_agent_works(): void
    {
        Route::middleware('auth:sanctum')
            ->get('/test-agent-probe', fn () => response()->json(['ok' => true]));

        $user = $this->member();
        $value = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->json('value');

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/agent-tokens')
            ->assertJsonPath('data.0.last_used_at', null);

        $this->app['auth']->forgetGuards();
        $this->withToken($value)->getJson('/test-agent-probe')->assertOk();
        // The agent's request is over; drop its credential so the member's next
        // request is the cookie one it would really be.
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();

        $listed = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/agent-tokens')
            ->json('data.0.last_used_at');

        $this->assertNotNull($listed);
    }

    public function test_revoking_removes_the_credential_outright(): void
    {
        $user = $this->member();
        $id = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->json('id');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/agent-tokens/{$id}")
            ->assertStatus(204);

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $id]);
    }

    public function test_mint_and_revoke_are_audit_logged(): void
    {
        $user = $this->member();
        $workspaceId = $user->personalWorkspace()->id;

        $id = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->json('id');

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspaceId,
            'user_id' => $user->id,
            'action' => 'agent_token.created',
            'subject_type' => AgentToken::class,
            'subject_id' => $id,
        ]);

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/agent-tokens/{$id}")
            ->assertStatus(204);

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspaceId,
            'action' => 'agent_token.revoked',
            'subject_type' => AgentToken::class,
            'subject_id' => $id,
        ]);
    }

    /**
     * The trail records that a credential existed and was named — never anything
     * that could be replayed as one.
     */
    public function test_the_audit_trail_never_carries_a_token_value(): void
    {
        $user = $this->member();

        $value = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Claude Code'])
            ->json('value');

        [, $plainText] = explode('|', $value, 2);

        foreach (AuditLog::all() as $log) {
            $this->assertStringNotContainsString($plainText, json_encode($log->meta) ?: '');
        }
    }

    public function test_the_list_is_only_the_callers_own_tokens(): void
    {
        $mine = $this->member();
        $theirs = $this->member('other@example.com');
        $theirs->createToken('Their agent', ['workspace:'.$theirs->personalWorkspace()->id]);

        $this->actingAs($mine)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'My agent'])
            ->assertStatus(201);

        $this->actingAs($mine)->fromWebApp()
            ->getJson('/api/v1/agent-tokens')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'My agent');
    }
}
