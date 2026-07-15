<?php

namespace Tests\Feature\Internal;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The API-mediated Kroki render cache over the HTTP seam (SPEC §6.2, testing
 * decision 1): render-once-per-(engine, source_hash), cache on the media disk,
 * and hand back a /storage URL — asserted as observable API state and disk
 * contents, with Kroki faked at the HTTP boundary so nothing touches a socket.
 */
class DiagramRenderTest extends TestCase
{
    private const SECRET = 'dev-diagram-secret'; // the testing-env default

    private const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

    private function render(array $body, ?string $secret = self::SECRET): TestResponse
    {
        $headers = $secret === null ? [] : ['X-Diagram-Secret' => $secret];

        return $this->postJson('/api/internal/diagrams', $body, $headers);
    }

    public function test_it_renders_a_diagram_via_kroki_and_caches_the_svg(): void
    {
        Storage::fake('public');
        Http::fake(['*' => Http::response(self::SVG, 200)]);

        $response = $this->render(['engine' => 'mermaid', 'source' => "graph TD\nA-->B"]);

        $response->assertOk();
        $url = $response->json('url');
        $this->assertIsString($url);
        $this->assertStringContainsString('/storage/diagrams/mermaid/', $url);
        $this->assertStringEndsWith('.svg', $url);

        // The SVG landed on the media disk as Kroki emitted it (served via <img>).
        Storage::disk('public')->assertExists('diagrams/mermaid/'.hash('sha256', "graph TD\nA-->B").'.svg');
        $this->assertStringContainsString('<svg', Storage::disk('public')->get(
            'diagrams/mermaid/'.hash('sha256', "graph TD\nA-->B").'.svg',
        ));

        // Kroki was asked for exactly this engine via the GET encoding.
        Http::assertSent(fn ($request) => str_contains($request->url(), '/mermaid/svg/'));
    }

    public function test_a_repeat_render_of_the_same_diagram_is_a_cache_hit_that_never_calls_kroki(): void
    {
        Storage::fake('public');
        Http::fake(['*' => Http::response(self::SVG, 200)]);

        $body = ['engine' => 'plantuml', 'source' => '@startuml'."\nA->B\n".'@enduml'];

        $first = $this->render($body);
        $second = $this->render($body);

        $first->assertOk();
        $second->assertOk();
        $this->assertSame($first->json('url'), $second->json('url'));

        // The whole point of the API cache: the second render is a disk hit —
        // Kroki is called exactly once across both requests.
        Http::assertSentCount(1);
    }

    public function test_the_same_source_under_different_engines_caches_separately(): void
    {
        Storage::fake('public');
        Http::fake(['*' => Http::response(self::SVG, 200)]);

        $this->render(['engine' => 'graphviz', 'source' => 'digraph { a -> b }'])->assertOk();
        $this->render(['engine' => 'd2', 'source' => 'digraph { a -> b }'])->assertOk();

        // Two engines, same source → two distinct cache entries, two renders.
        Http::assertSentCount(2);
        Storage::disk('public')->assertExists('diagrams/graphviz/'.hash('sha256', 'digraph { a -> b }').'.svg');
        Storage::disk('public')->assertExists('diagrams/d2/'.hash('sha256', 'digraph { a -> b }').'.svg');
    }

    public function test_an_unsupported_engine_is_never_forwarded_to_kroki(): void
    {
        Http::fake();

        $response = $this->render(['engine' => 'evil-engine', 'source' => 'x']);

        $response->assertStatus(422)->assertJsonPath('error', 'unsupported_engine');
        Http::assertNothingSent();
    }

    public function test_a_kroki_failure_returns_render_failed_and_logs_the_event(): void
    {
        Storage::fake('public');
        Log::spy();
        // Kroki answers a bad-source diagram with a non-2xx and a text reason.
        Http::fake(['*' => Http::response('Syntax error in line 2', 400)]);

        $response = $this->render(['engine' => 'mermaid', 'source' => 'not a diagram']);

        $response->assertStatus(422)->assertJsonPath('error', 'render_failed');
        Log::shouldHaveReceived('warning')->withArgs(
            fn (string $event, array $ctx = []) => $event === 'kroki.render_failed' && ($ctx['engine'] ?? null) === 'mermaid',
        )->once();
    }

    public function test_a_non_svg_kroki_body_is_treated_as_a_render_failure(): void
    {
        Storage::fake('public');
        Http::fake(['*' => Http::response('this is not svg at all', 200)]);

        $this->render(['engine' => 'mermaid', 'source' => 'x'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'render_failed');
    }

    public function test_it_rejects_a_missing_secret_with_404_without_calling_kroki(): void
    {
        Http::fake();

        $this->render(['engine' => 'mermaid', 'source' => 'x'], secret: null)->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_it_rejects_a_wrong_secret_with_404(): void
    {
        Http::fake();

        $this->render(['engine' => 'mermaid', 'source' => 'x'], secret: 'wrong-secret')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_it_fails_closed_in_production_when_no_secret_is_configured(): void
    {
        $this->app['env'] = 'production';
        config()->set('kedge.diagram.secret', null);
        Http::fake();

        // Even the dev default must not open the endpoint in production.
        $this->render(['engine' => 'mermaid', 'source' => 'x'], secret: self::SECRET)->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_it_validates_the_request_body(): void
    {
        $this->render(['engine' => 'mermaid'])->assertStatus(422); // missing source
        $this->render(['source' => 'x'])->assertStatus(422);       // missing engine
    }
}
