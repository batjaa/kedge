<?php

namespace Tests\Feature\Api\V1;

use App\Http\Middleware\RejectAgentTokenAuth;
use App\Models\Document;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Tests\TestCase;

/**
 * Agent tokens are MCP-only, by construction (SPEC §15; m4-ai-agents eng review
 * §1). This is the behavioural half of that rule — the exhaustive route sweep
 * lives in the IDOR matrix (G1).
 *
 * The token itself is a perfectly good credential: it authenticates outside the
 * versioned REST surface, and Sanctum stamps its last-used time when it does.
 * What it can never do is act as a human on `/api/v1` — which is what keeps the
 * closed MCP tool list (no approvals, no lifecycle, no token minting) an actual
 * guarantee rather than a policy that could regress.
 */
class AgentTokenRestRejectionTest extends TestCase
{
    use RefreshDatabase;

    /** A stand-in for the MCP endpoint (#135): a token-authenticated route outside /api/v1. */
    private function probeRoute(): void
    {
        Route::middleware('auth:sanctum')
            ->get('/test-agent-probe', fn () => response()->json(['ok' => true]));
    }

    private function member(): User
    {
        return app(RegistrationService::class)->register(
            name: 'Agent Operator',
            email: 'operator@example.com',
            password: 'correct-horse-battery',
        );
    }

    private function mint(User $user): string
    {
        return $user->createToken(
            'Claude Code',
            ['workspace:'.$user->personalWorkspace()->id],
        )->plainTextToken;
    }

    public function test_a_token_authenticates_outside_the_rest_v1_surface(): void
    {
        $this->probeRoute();
        $token = $this->mint($this->member());

        $this->withToken($token)
            ->getJson('/test-agent-probe')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_using_a_token_stamps_its_last_used_at(): void
    {
        $this->probeRoute();
        $user = $this->member();
        $token = $this->mint($user);

        $this->assertNull($user->tokens()->sole()->last_used_at);

        $this->withToken($token)->getJson('/test-agent-probe')->assertOk();

        $this->assertNotNull($user->tokens()->sole()->fresh()->last_used_at);
    }

    public function test_a_revoked_token_fails_on_the_agents_very_next_call(): void
    {
        $this->probeRoute();
        $user = $this->member();
        $token = $this->mint($user);

        $this->withToken($token)->getJson('/test-agent-probe')->assertOk();

        $user->tokens()->delete();

        // Test-harness artifact only: the container's guard instance memoizes the
        // user it resolved, and a second request in the same test reuses it. Every
        // real request is a fresh application, so revocation lands on the very next
        // call with nothing to forget.
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/test-agent-probe')->assertUnauthorized();
    }

    public function test_a_valid_token_is_refused_on_a_rest_v1_read(): void
    {
        $user = $this->member();
        $token = $this->mint($user);

        $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_a_valid_token_cannot_mint_another_token(): void
    {
        $user = $this->member();
        $token = $this->mint($user);

        $this->withToken($token)
            ->postJson('/api/v1/agent-tokens', ['name' => 'Second agent'])
            ->assertUnauthorized();

        $this->assertSame(1, $user->tokens()->count());
    }

    public function test_a_valid_token_cannot_revoke_a_token(): void
    {
        $user = $this->member();
        $token = $this->mint($user);
        $id = $user->tokens()->sole()->id;

        $this->withToken($token)
            ->deleteJson("/api/v1/agent-tokens/{$id}")
            ->assertUnauthorized();

        $this->assertDatabaseHas('personal_access_tokens', ['id' => $id]);
    }

    /**
     * The rejection is on the credential, not on a successful lookup: an
     * unparseable, expired, or already-revoked bearer is refused the same way, so
     * no timing difference and no future guard change can turn REST v1 into a
     * token surface.
     */
    public function test_even_a_garbage_bearer_credential_is_refused_on_rest_v1(): void
    {
        $this->getJson('/api/v1/config')->assertOk();

        $this->withToken('1|not-a-real-token')
            ->getJson('/api/v1/config')
            ->assertUnauthorized();
    }

    /**
     * The refusal happens before route-model binding, so a token holder cannot
     * use the 401/404 split as an existence oracle over every v1 resource.
     */
    public function test_the_refusal_leaks_no_resource_existence(): void
    {
        $user = $this->member();
        $token = $this->mint($user);
        $document = Document::factory()
            ->for($user->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $user->id]);

        $this->withToken($token)
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertUnauthorized();

        $this->app['auth']->forgetGuards();

        $this->withToken($token)
            ->getJson('/api/v1/documents/'.($document->id + 9999))
            ->assertUnauthorized();
    }

    /**
     * `POST /logout` is a root-level `auth:sanctum` route outside `/api/v1`. A
     * prefix-scoped rule left it open: an agent bearer got a 204 and a refreshed
     * `last_used_at`, which is both a human-only action and a token-validity
     * oracle. The rule is app-wide, so it is closed. (Found by the #131 codex
     * gate.)
     */
    public function test_the_root_level_sign_out_route_refuses_a_token(): void
    {
        $user = $this->member();
        $token = $this->mint($user);

        $this->withToken($token)
            ->postJson('/logout')
            ->assertUnauthorized();

        // No lookup happened, so the token learns nothing about its own validity.
        $this->assertNull($user->tokens()->sole()->fresh()->last_used_at);
    }

    /**
     * Ordering is the security property, not a detail: the refusal must precede
     * Sanctum's stateful wrapper (which starts the session and CSRF stack), the
     * rate limiters, and route-model binding. Asserted on the resolved pipeline
     * so a future group edit that reorders it fails here.
     */
    public function test_the_refusal_is_ordered_ahead_of_session_throttling_and_binding(): void
    {
        $route = collect(app('router')->getRoutes()->getRoutes())
            ->first(fn ($route): bool => $route->uri() === 'api/v1/agent-tokens');

        $middleware = array_values(array_filter(
            app('router')->gatherRouteMiddleware($route),
            'is_string',
        ));

        $this->assertSame(RejectAgentTokenAuth::class, $middleware[0] ?? null);

        foreach ([EnsureFrontendRequestsAreStateful::class, SubstituteBindings::class] as $later) {
            $this->assertGreaterThan(
                0,
                array_search($later, $middleware, true),
                $later.' must run after the agent-token refusal',
            );
        }
    }

    /**
     * The corollary of that ordering, asserted as behaviour: a rejected request
     * does no database work at all. With the database session driver, a session
     * that had started would show up here immediately.
     */
    public function test_a_rejected_request_touches_no_database(): void
    {
        $user = $this->member();
        $token = $this->mint($user);

        DB::flushQueryLog();
        DB::enableQueryLog();

        // A stateful Origin: the shape that previously reached session + CSRF.
        $this->withToken($token)->fromWebApp()
            ->postJson('/api/v1/agent-tokens', ['name' => 'Second agent'])
            ->assertUnauthorized();

        $this->assertSame([], DB::getRawQueryLog());
        DB::disableQueryLog();
    }

    /**
     * The BFF cookie path is untouched — the first-party SPA never carries an
     * Authorization header, so the rule is invisible to it.
     */
    public function test_the_first_party_cookie_path_is_untouched(): void
    {
        $user = $this->member();
        $this->mint($user);

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/me')
            ->assertOk();
    }
}
