<?php

namespace Tests\Feature\Api\V1;

use App\Models\Integration;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The integration connect flow over the API HTTP seam (SPEC §16, §13, ticket
 * #23): connect a PAT, list it masked, disconnect it — and, the security point of
 * the ticket, prove the token is never serialized into any response and the
 * masked listing exposes at most a last-4 hint.
 */
class IntegrationApiTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'ghp_apiSECRETtoken1111111111111111wxyz';

    public function test_connect_stores_the_token_and_returns_only_the_mask(): void
    {
        $user = $this->registerUser();

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/integrations', ['token' => self::TOKEN]);

        $response->assertStatus(201)
            ->assertJsonPath('provider', 'github_pat')
            ->assertJsonPath('token_last_four', 'wxyz')
            // The response carries only the mask — never the token, never the
            // ciphertext, never a `credentials` key.
            ->assertJsonMissingPath('token')
            ->assertJsonMissingPath('credentials');

        // The token IS stored (encrypted) — usable by the connector, invisible to responses.
        $integration = Integration::sole();
        $this->assertSame(self::TOKEN, $integration->token());
        $this->assertSame($user->personalWorkspace()->id, $integration->workspace_id);

        // The whole serialized response body contains the token nowhere.
        $this->assertStringNotContainsString(self::TOKEN, $response->getContent());
    }

    public function test_the_ciphertext_at_rest_is_not_the_plaintext_token(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/integrations', ['token' => self::TOKEN])
            ->assertStatus(201);

        // Read the raw column, bypassing the cast: it must be ciphertext, and the
        // plaintext token must not appear in it.
        $raw = (string) Integration::sole()->getRawOriginal('credentials');
        $this->assertNotSame('', $raw);
        $this->assertStringNotContainsString(self::TOKEN, $raw);
    }

    public function test_the_model_never_serializes_its_credentials(): void
    {
        $integration = Integration::factory()->withToken(self::TOKEN)->create();

        // Both array and JSON serialization drop `credentials` via the model's
        // Hidden attribute — an independent guard from the resource allowlist.
        $this->assertArrayNotHasKey('credentials', $integration->toArray());
        $this->assertStringNotContainsString(self::TOKEN, $integration->toJson());
    }

    public function test_list_returns_the_masked_connections(): void
    {
        $user = $this->registerUser();
        Integration::factory()->withToken(self::TOKEN)
            ->for($user->personalWorkspace())
            ->create();

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/integrations');

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.provider', 'github_pat')
            ->assertJsonPath('data.0.token_last_four', 'wxyz');

        $this->assertStringNotContainsString(self::TOKEN, $response->getContent());
    }

    public function test_list_is_scoped_to_the_callers_own_workspace(): void
    {
        [$owner] = $this->ownerWithIntegration();
        $other = $this->registerUser('other@example.com');

        // Another user sees their own (empty) list — never the owner's connection.
        $this->actingAs($other)->fromWebApp()
            ->getJson('/api/v1/integrations')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_disconnect_removes_the_integration(): void
    {
        [$owner, $integration] = $this->ownerWithIntegration();

        $this->actingAs($owner)->fromWebApp()
            ->deleteJson("/api/v1/integrations/{$integration->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('integrations', ['id' => $integration->id]);
    }

    public function test_connect_requires_a_token(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/integrations', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('token');

        $this->assertDatabaseCount('integrations', 0);
    }

    public function test_connect_rejects_an_unknown_provider(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/integrations', ['provider' => 'confluence', 'token' => self::TOKEN])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('provider');
    }

    // --- helpers ------------------------------------------------------------

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    /**
     * @return array{User, Integration}
     */
    private function ownerWithIntegration(): array
    {
        $owner = $this->registerUser('owner@example.com');
        $integration = Integration::factory()->withToken(self::TOKEN)
            ->for($owner->personalWorkspace())
            ->create();

        return [$owner, $integration];
    }
}
