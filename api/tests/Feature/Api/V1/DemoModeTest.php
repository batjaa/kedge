<?php

namespace Tests\Feature\Api\V1;

use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\Share;
use App\Services\Fetch\BlockReason;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\DocumentImporter;
use App\Services\SystemWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Instant demo mode over the API HTTP seam (SPEC §10.3, testing decision 1, #25).
 *
 * The PLG wedge as observable API state: an anonymous POST accepts and hands back
 * a share URL; the doc lands in the reserved system workspace with a TTL and no
 * creator; public connectors only; the SSRF guard applies for free; per-IP rate
 * limits trip; and the whole surface 404s when self-hosted. Job internals are
 * never asserted — only what the API returns and what the database holds.
 */
class DemoModeTest extends TestCase
{
    use RefreshDatabase;

    private const RAW_URL = 'https://raw.githubusercontent.com/kedgehq/kedge/main/README.md';

    private const GITHUB_BLOB = 'https://github.com/kedgehq/kedge/blob/main/README.md';

    public function test_anonymous_demo_import_accepts_and_returns_a_share_url(): void
    {
        Queue::fake();

        // No actingAs, no cookie: the surface is unauthenticated by design.
        $response = $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL]);

        $response->assertStatus(202)
            ->assertJsonPath('status', 'importing')
            ->assertJsonStructure(['status', 'share_url', 'expires_at']);

        $shareUrl = $response->json('share_url');
        $this->assertStringContainsString('/shared/', $shareUrl);

        // The doc is a demo doc: system workspace, no creator, a ~48h TTL.
        $document = Document::sole();
        $this->assertSame(SourceType::RawUrl, $document->source_type);
        $this->assertNull($document->created_by, 'A demo doc is imported anonymously.');
        $this->assertSame(app(SystemWorkspace::class)->id(), $document->workspace_id);
        $this->assertNotNull($document->expires_at);
        $this->assertTrue($document->expires_at->between(now()->addHours(47), now()->addHours(49)));
        $this->assertTrue($document->isDemo());

        // A share was minted (anonymously — no creator) so the visitor can watch
        // it land and come back to it.
        $this->assertDatabaseCount('shares', 1);
        $share = Share::sole();
        $this->assertNull($share->created_by);

        // The import was queued, exactly like a signed-in import.
        Queue::assertPushed(ImportDocumentJob::class, fn (ImportDocumentJob $job) => $job->document->is($document));
    }

    public function test_demo_import_records_a_demo_created_audit_event(): void
    {
        Queue::fake();

        $this->fromWebApp()->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL])->assertStatus(202);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'demo.created',
            'workspace_id' => app(SystemWorkspace::class)->id(),
            'user_id' => null,
        ]);
    }

    public function test_demo_import_accepts_a_public_github_blob_url(): void
    {
        Queue::fake();

        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => self::GITHUB_BLOB])
            ->assertStatus(202);

        $this->assertSame(SourceType::GithubPublic, Document::sole()->source_type);
    }

    public function test_demo_import_rejects_pasted_content_public_connectors_only(): void
    {
        Queue::fake();

        // No `url`: demo mode is URL-only (public connectors), so there is no paste
        // path at all — the request is rejected before any document is created.
        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['content' => "# Pasted\n\nnope"])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->assertDatabaseCount('documents', 0);
    }

    public function test_demo_import_rejects_a_non_http_url(): void
    {
        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => 'ftp://example.test/spec.md'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->assertDatabaseCount('documents', 0);
    }

    public function test_demo_fetch_is_ssrf_guarded(): void
    {
        Queue::fake();
        // The SSRF guard comes free via the shared fetcher: a URL resolving to a
        // private range is blocked, and the demo import fails deterministically —
        // never a probe of the private network (SPEC §13).
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')
                ->andThrow(new BlockedUrlException(BlockReason::PrivateAddress, 'resolves to private range')),
        );

        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => 'https://internal.corp/spec.md'])
            ->assertStatus(202);

        $document = Document::sole();
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));

        $document->refresh();
        $this->assertSame(DocumentStatus::Failed, $document->status);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertSame('URL not allowed (private address).', $document->sync_error);
    }

    public function test_demo_doc_renders_through_its_share_link_with_a_claim_cta(): void
    {
        // End-to-end over the API: import → the returned share URL reads the doc,
        // and it advertises itself as claimable (with its id) so the web can wire
        // the "Claim this doc" CTA.
        $this->fakeFetchReturns("# Demo Doc\n\nRendered anonymously.\n");
        $this->fakeProjection();

        $response = $this->fromWebApp()->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL]);
        $token = Str::afterLast($response->json('share_url'), '/shared/');

        $document = Document::sole();
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));

        $this->getJson("/api/v1/shared/{$token}")
            ->assertOk()
            ->assertJsonPath('title', 'Demo Doc')
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('claimable', true)
            ->assertJsonPath('document_id', $document->id)
            ->assertJsonPath('current_version.content', "# Demo Doc\n\nRendered anonymously.\n");
    }

    public function test_an_ordinary_share_is_not_claimable(): void
    {
        // A normal (non-demo) doc's share never advertises a claim, and never
        // leaks its internal id.
        $document = Document::factory()->ready()->create();
        $token = Str::random(48);
        Share::factory()->for($document)->withToken($token)->create();

        $this->getJson("/api/v1/shared/{$token}")
            ->assertOk()
            ->assertJsonPath('claimable', false)
            ->assertJsonMissingPath('document_id');
    }

    public function test_demo_endpoint_is_rate_limited_per_ip(): void
    {
        Queue::fake();
        config(['kedge.demo.rate_per_minute' => 3]);

        for ($i = 0; $i < 3; $i++) {
            $this->fromWebApp()
                ->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL])
                ->assertStatus(202);
        }

        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL])
            ->assertTooManyRequests();
    }

    public function test_config_reports_the_edition(): void
    {
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('self_hosted', false);

        config(['kedge.self_hosted' => true]);
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('self_hosted', true);
    }

    public function test_self_hosted_removes_the_demo_endpoint(): void
    {
        config(['kedge.self_hosted' => true]);

        $this->fromWebApp()
            ->postJson('/api/v1/demo/documents', ['url' => self::RAW_URL])
            ->assertNotFound();

        $this->assertDatabaseCount('documents', 0);
    }

    // ---- helpers ------------------------------------------------------------

    private function fakeFetchReturns(string $body, string $contentType = 'text/markdown'): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')
                ->andReturn(new FetchResult(200, $body, $contentType, self::RAW_URL)),
        );
    }

    private function fakeProjection(): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => 'Projected text.',
                'projection_version' => '1',
                'mdx_ok' => true,
                'warnings' => [],
            ]),
        ]);
    }
}
