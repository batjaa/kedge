<?php

namespace Tests\Feature\Api\V1;

use App\Enums\CommentClient;
use App\Http\Middleware\EnsureMcpEnabled;
use App\Http\Middleware\RejectAgentTokenAuth;
use App\Http\Middleware\RequireAgentTokenAuth;
use App\Http\Middleware\ThrottleMcpIngress;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Services\Agents\AgentTokenService;
use App\Services\RegistrationService;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Laravel\Mcp\Server\Middleware\AddWwwAuthenticateHeader;
use Laravel\Mcp\Server\Middleware\ReorderJsonAccept;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Tests\TestCase;

/**
 * The MCP endpoint as an agent actually meets it (SPEC §15, #135): over HTTP,
 * with a bearer token, speaking JSON-RPC.
 *
 * The tool behaviour lives in tests/Feature/Mcp; what only this file can prove
 * is the transport and the credential rules around it — that the one route in
 * the application which accepts an Agent Token accepts nothing else, answers
 * 401 the moment that token is revoked, and disappears entirely when the
 * operator switches the surface off.
 */
class McpEndpointTest extends TestCase
{
    use RefreshDatabase;

    private const ENDPOINT = '/api/v1/mcp';

    private User $operator;

    private Document $document;

    protected function setUp(): void
    {
        parent::setUp();

        $this->operator = app(RegistrationService::class)->register(
            name: 'Agent Operator',
            email: 'operator@example.com',
            password: 'correct-horse-battery',
        );

        $content = "# RFC 017\n\nAnchors survive versions.\n";
        $this->document = Document::factory()
            ->for($this->operator->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['title' => 'RFC 017', 'created_by' => $this->operator->id]);

        $version = DocumentVersion::factory()->for($this->document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => 'Anchors survive versions.',
            'projection_version' => (string) config('kedge.projection.current_version'),
        ]);
        $this->document->forceFill(['current_version_id' => $version->id])->save();
    }

    private function mintToken(): string
    {
        return $this->operator
            ->createToken('Claude Code', ['workspace:'.$this->operator->personalWorkspace()->id])
            ->plainTextToken;
    }

    /**
     * @param  array<string, mixed>  $params
     */
    private function rpc(string $token, string $method, array $params = [], int $id = 1): TestResponse
    {
        return $this->withToken($token)->postJson(self::ENDPOINT, [
            'jsonrpc' => '2.0',
            'id' => $id,
            'method' => $method,
            'params' => $params,
        ]);
    }

    public function test_an_agent_completes_the_mcp_handshake(): void
    {
        $response = $this->rpc($this->mintToken(), 'initialize', [
            'protocolVersion' => '2025-06-18',
            'capabilities' => [],
            'clientInfo' => ['name' => 'kedge-tests', 'version' => '1.0'],
        ]);

        $response->assertOk();
        $body = json_decode($response->getContent(), true);

        $this->assertSame('Kedge', $body['result']['serverInfo']['name']);
        $this->assertArrayHasKey('tools', $body['result']['capabilities']);
        // The endpoint hands back a session id the client echoes on later calls.
        $this->assertNotEmpty($response->headers->get('MCP-Session-Id'));
    }

    public function test_tools_list_over_http_is_the_closed_surface(): void
    {
        $response = $this->rpc($this->mintToken(), 'tools/list');

        $response->assertOk();
        $body = json_decode($response->getContent(), true);
        $names = array_column($body['result']['tools'], 'name');

        sort($names);
        $this->assertSame([
            'get_digest',
            'get_document',
            'get_improve_prompt',
            'get_thread',
            'list_documents',
            'list_threads',
            'post_comment',
            'reply',
        ], $names);
    }

    public function test_an_agent_posts_a_comment_over_http_and_it_persists_as_an_mcp_write(): void
    {
        // The demo criterion in miniature: a token, a tool call, a real row.
        $response = $this->rpc($this->mintToken(), 'tools/call', [
            'name' => 'post_comment',
            'arguments' => [
                'document_id' => $this->document->id,
                'body' => 'This section needs a worked example.',
            ],
        ]);

        $response->assertOk();
        $body = json_decode($response->getContent(), true);
        $this->assertArrayNotHasKey('error', $body);
        $this->assertFalse($body['result']['isError']);

        $comment = Comment::query()->sole();
        $this->assertSame(CommentClient::Mcp, $comment->client);
        $this->assertSame($this->operator->id, $comment->author_id);
        $this->assertSame(1, Thread::query()->count());
    }

    public function test_an_agent_reads_an_ai_artifact_over_http_on_an_instance_with_no_key(): void
    {
        // #136 over the wire, in the configuration a self-hoster is most likely
        // to be in: MCP on, no ANTHROPIC_API_KEY. The tool answers — honestly,
        // with an empty artifact — instead of erroring or 404ing, which is what
        // "MCP is gated independently of AI" has to mean at the transport.
        $this->assertFalse((bool) config('kedge.ai.enabled'));

        $response = $this->rpc($this->mintToken(), 'tools/call', [
            'name' => 'get_digest',
            'arguments' => ['document_id' => $this->document->id],
        ]);

        $response->assertOk();
        $body = json_decode($response->getContent(), true);

        $this->assertArrayNotHasKey('error', $body);
        $this->assertFalse($body['result']['isError']);
        $this->assertSame([
            'document_id' => $this->document->id,
            'type' => 'digest',
            'ai_enabled' => false,
            // Not looked up: with no provider there is nothing to report on.
            'latest_run_status' => null,
            'artifact' => null,
            'note' => 'This Kedge instance has no AI provider configured, so no review digest exists to read. '
                .'The rest of the review — documents, threads, comments — is unaffected.',
        ], $body['result']['structuredContent']);
    }

    public function test_the_endpoint_refuses_an_unauthenticated_call(): void
    {
        $this->postJson(self::ENDPOINT, [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'tools/list',
            'params' => [],
        ])->assertUnauthorized();
    }

    public function test_a_revoked_token_fails_the_agents_next_call_with_401(): void
    {
        $issued = $this->operator->createToken('Claude Code', ['workspace:'.$this->operator->personalWorkspace()->id]);
        $token = $issued->plainTextToken;

        $this->rpc($token, 'tools/list')->assertOk();

        app(AgentTokenService::class)->revoke($issued->accessToken);

        // Revocation is the row: nothing to expire, nothing cached.
        $this->app['auth']->forgetGuards();
        $this->rpc($token, 'tools/list')->assertUnauthorized();
    }

    public function test_a_garbage_bearer_token_is_refused(): void
    {
        $this->rpc('not-a-real-token', 'tools/list')->assertUnauthorized();
    }

    public function test_a_first_party_session_cannot_drive_the_agent_surface(): void
    {
        // Sanctum's stateful path would otherwise let a signed-in human's browser
        // call these tools — and every comment it wrote would be badged as an
        // agent. The badge only means something if the surface that stamps it
        // takes agent credentials and nothing else.
        $this->actingAs($this->operator)->fromWebApp()
            ->postJson(self::ENDPOINT, [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'tools/list',
                'params' => [],
            ])
            ->assertUnauthorized();

        $this->assertSame(0, Comment::query()->count());
    }

    public function test_the_endpoint_is_absent_when_the_mcp_gate_is_off(): void
    {
        config(['kedge.mcp.enabled' => false]);

        $this->rpc($this->mintToken(), 'tools/list')->assertNotFound();
    }

    public function test_a_switched_off_surface_is_absent_to_every_caller_alike(): void
    {
        // "Off means absent" has to mean absent to ANYONE. If the gate resolved
        // after the guard, an anonymous call would 401 and only a valid
        // credential would 404 — turning the feature flag into an oracle that
        // says "that token is real". Hoisting the gate ahead of authentication
        // is what makes all three answers identical.
        config(['kedge.mcp.enabled' => false]);
        $body = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list', 'params' => []];

        $this->postJson(self::ENDPOINT, $body)->assertNotFound();
        $this->withToken('not-a-real-token')->postJson(self::ENDPOINT, $body)->assertNotFound();
        $this->withToken($this->mintToken())->postJson(self::ENDPOINT, $body)->assertNotFound();
    }

    public function test_a_switched_off_surface_touches_no_credential(): void
    {
        // ...and it does no auth work either: a request that never reaches the
        // guard leaves last_used_at alone, so a disabled endpoint cannot even be
        // used to probe whether a token is live.
        config(['kedge.mcp.enabled' => false]);
        $issued = $this->operator->createToken('Claude Code', ['workspace:'.$this->operator->personalWorkspace()->id]);

        $this->withToken($issued->plainTextToken)
            ->postJson(self::ENDPOINT, ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list', 'params' => []])
            ->assertNotFound();

        $this->assertNull($issued->accessToken->fresh()->last_used_at);
    }

    public function test_unauthenticated_ingress_is_rate_limited_before_the_guard(): void
    {
        // The per-token limiter cannot bound traffic that never authenticates —
        // Laravel resolves auth:sanctum in front of ThrottleRequests, so a
        // garbage bearer 401s before the named limiter is ever reached. Without a
        // pre-auth ceiling, probing the endpoint costs a Sanctum lookup each time
        // and nothing counts it.
        config(['kedge.mcp.rate_per_minute' => 2]);
        $body = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list', 'params' => []];

        $this->withToken('garbage-one')->postJson(self::ENDPOINT, $body)->assertUnauthorized();
        $this->withToken('garbage-two')->postJson(self::ENDPOINT, $body)->assertUnauthorized();

        $throttled = $this->withToken('garbage-three')->postJson(self::ENDPOINT, $body);
        $throttled->assertStatus(429);
        $this->assertNotEmpty($throttled->headers->get('Retry-After'));
    }

    public function test_anonymous_ingress_is_rate_limited_too(): void
    {
        config(['kedge.mcp.rate_per_minute' => 1]);
        $body = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list', 'params' => []];

        $this->postJson(self::ENDPOINT, $body)->assertUnauthorized();
        $this->postJson(self::ENDPOINT, $body)->assertStatus(429);
    }

    public function test_the_mcp_gate_does_not_depend_on_the_ai_gate(): void
    {
        // A self-hosted instance with no Anthropic key still hosts agent
        // reviewers — the single most load-bearing sentence of the M4 gate design.
        config(['kedge.ai.enabled' => false, 'kedge.mcp.enabled' => true]);

        $this->rpc($this->mintToken(), 'tools/list')->assertOk();
    }

    public function test_get_and_delete_answer_405_rather_than_an_auth_error(): void
    {
        // The MCP transport spec: a server with no SSE stream answers 405 on GET.
        // A 401 in its place would read to a client as a credential problem, so
        // the RejectAgentTokenAuth opt-out deliberately covers all three methods.
        $token = $this->mintToken();

        $this->withToken($token)->get(self::ENDPOINT)->assertStatus(405);
        $this->withToken($token)->delete(self::ENDPOINT)->assertStatus(405);
    }

    public function test_the_endpoint_is_rate_limited(): void
    {
        config(['kedge.mcp.rate_per_minute' => 2]);
        $token = $this->mintToken();

        $this->rpc($token, 'ping')->assertOk();
        $this->rpc($token, 'ping')->assertOk();
        $this->rpc($token, 'ping')->assertStatus(429);
    }

    public function test_the_route_group_is_the_only_agent_token_exemption_in_the_application(): void
    {
        // The structural half of "agent tokens are MCP-only": not just that the
        // MCP endpoint accepts a token, but that NOTHING ELSE has opted out of
        // the app-wide refusal. A future ticket adding `withoutMiddleware` to
        // another route fails here.
        $exempt = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route): bool => in_array(RejectAgentTokenAuth::class, $route->excludedMiddleware(), true))
            ->map(fn ($route): string => implode('|', $route->methods()).' '.$route->uri())
            ->sort()
            ->values()
            ->all();

        $this->assertSame([
            'DELETE api/v1/mcp',
            'GET|HEAD api/v1/mcp',
            'POST api/v1/mcp',
        ], $exempt);
    }

    public function test_the_mcp_route_requires_an_agent_token_and_the_gate(): void
    {
        $route = collect(app('router')->getRoutes()->getRoutes())
            ->first(fn ($route): bool => $route->uri() === 'api/v1/mcp' && in_array('POST', $route->methods(), true));

        $middleware = app('router')->gatherRouteMiddleware($route);

        // The ORDER is the security property, not just the membership: the gate
        // and the ingress limiter must resolve ahead of the guard, and the
        // agent-token requirement behind it (it needs a principal to inspect).
        $this->assertSame([
            EnsureMcpEnabled::class,
            ThrottleMcpIngress::class,
            EnsureFrontendRequestsAreStateful::class,
            Authenticate::class.':sanctum',
            ThrottleRequests::class.':mcp',
            SubstituteBindings::class,
            RequireAgentTokenAuth::class,
            ReorderJsonAccept::class,
            AddWwwAuthenticateHeader::class,
        ], $middleware);

        $this->assertNotContains(RejectAgentTokenAuth::class, $middleware);
    }

    public function test_the_capability_endpoint_reports_the_mcp_gate_independently(): void
    {
        config(['kedge.mcp.enabled' => true, 'kedge.ai.enabled' => false]);

        $this->getJson('/api/v1/config')
            ->assertOk()
            ->assertJsonPath('mcp.enabled', true)
            ->assertJsonPath('ai.enabled', false);
    }

    public function test_the_capability_endpoint_reports_the_gate_switched_off(): void
    {
        config(['kedge.mcp.enabled' => false]);

        $this->getJson('/api/v1/config')
            ->assertOk()
            ->assertJsonPath('mcp.enabled', false);
    }
}
