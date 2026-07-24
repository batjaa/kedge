<?php

namespace Tests\Feature\Api\V1;

use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\Integration;
use App\Models\User;
use App\Services\Fetch\BlockReason;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\DocumentImporter;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\ProjectionFailedException;
use App\Services\RegistrationService;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The import tracer over the API HTTP seam (SPEC 5.3, testing decision 1): the
 * 202 → poll lifecycle, content-hash dedupe, and the §19 failure paths — all as
 * observable API state, never job internals. The one external boundary, the
 * guarded fetcher, is faked in the container; nothing here touches a socket.
 */
class DocumentImportTest extends TestCase
{
    use RefreshDatabase;

    private const RAW_URL = 'https://raw.githubusercontent.com/kedgehq/kedge/main/README.md';

    public function test_import_accepts_202_then_polls_to_ready(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Hello Kedge\n\nA rendered doc.\n");
        $this->fakeProjection();
        $user = $this->registerUser();

        $create = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL]);

        $create->assertStatus(202)
            ->assertJsonPath('status', 'importing')
            ->assertJsonPath('source_type', 'raw_url')
            ->assertJsonPath('source_url', self::RAW_URL);

        $document = Document::sole();
        $this->assertSame(DocumentStatus::Importing, $document->status);
        Queue::assertPushed(
            ImportDocumentJob::class,
            fn (ImportDocumentJob $job) => $job->document->is($document),
        );

        // Run the queued import with the fetcher faked at its seam.
        $this->runImport($document);

        $poll = $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}");

        $poll->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('last_sync_status', 'ok')
            ->assertJsonPath('title', 'Hello Kedge') // synthesized from first heading
            ->assertJsonPath('current_version.content', "# Hello Kedge\n\nA rendered doc.\n")
            ->assertJsonPath('current_version.content_hash', hash('sha256', "# Hello Kedge\n\nA rendered doc.\n"));

        $this->assertDatabaseCount('document_versions', 1);
    }

    public function test_a_settled_import_records_document_imported_with_a_display_snapshot(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Hello Kedge\n\nA rendered doc.\n");
        $this->fakeProjection();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        // "Import settled ready" carries the freshly-synthesized title and the
        // requester's name so the feed row renders without hydrating the document.
        $entry = AuditLog::query()->where('action', 'document.imported')->sole();
        $this->assertSame($document->id, $entry->subject_id);
        $this->assertSame('Hello Kedge', $entry->meta['document_title']);
        $this->assertSame('Doc Author', $entry->meta['actor_name']);
    }

    public function test_a_redelivered_import_does_not_double_emit_the_settle_event(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Hello Kedge\n\nA rendered doc.\n");
        $this->fakeProjection();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();

        // First run settles the import. A redelivery of the same job (worker crash
        // after commit, expired unique lock) re-runs import() over already-Ready
        // content — a no-op save that must not emit a second feed row / M5 notice.
        $this->runImport($document);
        $this->runImport($document->fresh());

        $this->assertSame(1, AuditLog::query()->where('action', 'document.imported')->count());
        $this->assertDatabaseCount('document_versions', 1);
    }

    public function test_a_failed_import_records_document_import_failed_with_a_display_reason(): void
    {
        Queue::fake();
        $this->fakeFetchThrows(new BlockedUrlException(BlockReason::PrivateAddress, 'resolves to private range'));
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => 'https://internal.corp/spec.md'])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        // "Import settled failed" — the symmetric counterpart to document.imported,
        // carrying the user-facing reason (never the raw exception) as its display.
        $entry = AuditLog::query()->where('action', 'document.import_failed')->sole();
        $this->assertSame($document->id, $entry->subject_id);
        $this->assertSame('URL not allowed (private address).', $entry->meta['reason']);
        $this->assertSame('Doc Author', $entry->meta['actor_name']);
        $this->assertSame(0, AuditLog::query()->where('action', 'document.imported')->count());
    }

    public function test_title_falls_back_to_filename_when_no_heading(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("Just a paragraph, no heading.\n", finalUrl: 'https://example.test/specs/api-design.md');
        $this->fakeProjection();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => 'https://example.test/specs/api-design.md'])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        $this->assertSame('Api Design', $document->fresh()->title);
    }

    public function test_identical_content_dedupes_onto_the_same_version(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Stable\n\nUnchanged body.\n");
        $this->fakeProjection();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();

        $this->runImport($document);
        $firstVersionId = $document->fresh()->current_version_id;

        // Re-run the import (a retry / re-sync) with byte-identical content: the
        // (document_id, content_hash) unique constraint returns the same version.
        $this->runImport($document->fresh());
        $secondVersionId = $document->fresh()->current_version_id;

        $this->assertNotNull($firstVersionId);
        $this->assertSame($firstVersionId, $secondVersionId);
        $this->assertDatabaseCount('document_versions', 1);
    }

    public function test_blocked_url_fails_immediately_with_a_friendly_message(): void
    {
        Queue::fake();
        $this->fakeFetchThrows(new BlockedUrlException(BlockReason::PrivateAddress, 'resolves to private range'));
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => 'https://internal.corp/spec.md'])
            ->assertStatus(202);

        $document = Document::sole();

        // Deterministic: handle() must not rethrow — a blocked URL is never retried.
        $this->runImport($document);

        $document->refresh();
        $this->assertSame(DocumentStatus::Failed, $document->status);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertSame('URL not allowed (private address).', $document->sync_error);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('status', 'failed')
            ->assertJsonPath('sync_error', 'URL not allowed (private address).');
    }

    public function test_upstream_failure_retries_then_marks_failed(): void
    {
        Queue::fake();
        // A 503 is returned (not thrown) by the guarded fetcher; the connector
        // turns a non-2xx into a transient failure the job may retry (SPEC 19).
        $this->fakeFetchReturns('', status: 503);
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();

        // A transient failure bubbles out of handle() so the queue retries it;
        // the document stays importing until the retry budget is spent.
        try {
            $this->runImport($document);
            $this->fail('Expected the transient import failure to bubble for a retry.');
        } catch (ImportFailedException) {
            // expected
        }
        $this->assertSame(DocumentStatus::Importing, $document->fresh()->status);

        // The queue exhausts its tries → the failed() hook records the terminal state.
        (new ImportDocumentJob($document->fresh()))->failed(new UpstreamFetchException('gave up'));

        $document->refresh();
        $this->assertSame(DocumentStatus::Failed, $document->status);
        $this->assertNotNull($document->sync_error);
    }

    public function test_failed_document_can_be_retried(): void
    {
        $user = $this->registerUser();
        $document = Document::factory()
            ->for($user->personalWorkspace(), 'workspace')
            ->failed('Import failed — the source could not be reached. Try again.')
            ->create(['created_by' => $user->id]);

        Queue::fake();
        $this->fakeFetchReturns("# Recovered\n\nNow it works.\n");
        $this->fakeProjection();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/retry")
            ->assertStatus(202)
            ->assertJsonPath('status', 'importing');

        $document->refresh();
        $this->assertSame(DocumentStatus::Importing, $document->status);
        $this->assertNull($document->sync_error);
        Queue::assertPushed(ImportDocumentJob::class);

        $this->runImport($document);
        $this->assertSame(DocumentStatus::Ready, $document->fresh()->status);
    }

    public function test_retry_rebinds_a_pat_document_to_the_reconnected_integration(): void
    {
        // A PAT-sourced import failed on a since-revoked token. The user reconnects
        // a fresh PAT (a new integration); retry must rebind the document to it, or
        // the queued job resolves the OLD integration_id and re-fails (#23, SPEC §19).
        Queue::fake();

        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $revoked = Integration::factory()->for($workspace)->create();
        $document = Document::factory()
            ->for($workspace, 'workspace')
            ->failed('GitHub access was revoked. Reconnect the integration in Settings.')
            ->create([
                'created_by' => $user->id,
                'source_type' => SourceType::GithubPat,
                'source_url' => 'https://github.com/acme/private/blob/main/spec.md',
                'integration_id' => $revoked->id,
            ]);

        // The reconnect: a fresh integration, now the workspace's current PAT.
        $reconnected = Integration::factory()->for($workspace)->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/retry")
            ->assertStatus(202);

        // Rebound to the reconnected token, not the revoked one it failed on.
        $this->assertSame($reconnected->id, $document->fresh()->integration_id);
        Queue::assertPushed(ImportDocumentJob::class);
    }

    public function test_retry_leaves_a_non_pat_document_binding_untouched(): void
    {
        // A raw-URL import carries no integration; retry must not invent one nor
        // trip over the PAT-only rebind branch.
        Queue::fake();

        $user = $this->registerUser();
        $document = Document::factory()
            ->for($user->personalWorkspace(), 'workspace')
            ->failed('Import failed — the source could not be reached. Try again.')
            ->create([
                'created_by' => $user->id,
                'source_type' => SourceType::RawUrl,
                'integration_id' => null,
            ]);

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/retry")
            ->assertStatus(202);

        $this->assertNull($document->fresh()->integration_id);
    }

    public function test_retry_rejects_a_document_that_is_not_failed(): void
    {
        $user = $this->registerUser();
        $document = Document::factory()
            ->for($user->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $user->id]);

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/retry")
            ->assertStatus(409);
    }

    public function test_import_rejects_a_non_http_url(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => 'ftp://example.test/spec.md'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->assertDatabaseCount('documents', 0);
    }

    public function test_import_endpoint_is_rate_limited(): void
    {
        $user = $this->registerUser();

        // The throttle runs before validation, so empty (422) bodies still spend
        // the per-user budget of 20/min; the 21st request trips 429.
        for ($i = 0; $i < 20; $i++) {
            $this->actingAs($user)->fromWebApp()
                ->postJson('/api/v1/documents', [])
                ->assertUnprocessable();
        }

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [])
            ->assertTooManyRequests();
    }

    public function test_import_job_is_unique_per_document(): void
    {
        $document = Document::factory()->create();
        $job = new ImportDocumentJob($document);

        $this->assertInstanceOf(ShouldBeUnique::class, $job);
        $this->assertSame((string) $document->id, $job->uniqueId());
    }

    public function test_import_projects_the_version_and_stores_the_substrate(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Doc\n\n![img](x.png)\n");
        // The web endpoint owns the projection; the API stores whatever it returns.
        $this->fakeProjection(plainText: "Doc\n\n⟦image⟧", version: '1');
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        // plain_text + projection_version land on the version (SPEC 5.4).
        $version = $document->fresh()->currentVersion;
        $this->assertSame("Doc\n\n⟦image⟧", $version->plain_text);
        $this->assertSame('1', $version->projection_version);

        // The importer POSTs the normalized content to the internal endpoint,
        // presenting the shared secret — faked here at its HTTP boundary.
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/projection')
            && $request->hasHeader('x-projection-secret')
            && $request['content'] === "# Doc\n\n![img](x.png)\n"
            && $request['format'] === 'md');
    }

    public function test_projection_failure_is_a_transient_import_failure(): void
    {
        Queue::fake();
        $this->fakeFetchReturns("# Doc\n\nbody\n");
        // The projection endpoint is down / errors: a 500 must be transient.
        Http::fake(['*/internal/projection' => Http::response(['error' => 'boom'], 500)]);
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::RAW_URL])
            ->assertStatus(202);

        $document = Document::sole();

        // Bubbles out of handle() so the queue retries it (SPEC 19) — never a
        // silently-unprojected version.
        try {
            $this->runImport($document);
            $this->fail('Expected the projection failure to bubble for a retry.');
        } catch (ProjectionFailedException) {
            // expected
        }

        $this->assertSame(DocumentStatus::Importing, $document->fresh()->status);
        $this->assertDatabaseCount('document_versions', 0);
    }

    // ---- helpers ------------------------------------------------------------

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    /**
     * Fake the guarded fetcher — the one external seam — to return a response.
     */
    private function fakeFetchReturns(
        string $body,
        string $contentType = 'text/markdown',
        int $status = 200,
        string $finalUrl = self::RAW_URL,
    ): void {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')
                ->andReturn(new FetchResult($status, $body, $contentType, $finalUrl)),
        );
    }

    private function fakeFetchThrows(\Throwable $e): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')->andThrow($e),
        );
    }

    /**
     * Fake the internal web projection endpoint at its HTTP boundary (testing
     * decision 1: the projection endpoint is faked, never called for real).
     *
     * @param  list<string>  $warnings
     */
    private function fakeProjection(
        string $plainText = 'Projected text.',
        string $version = '1',
        array $warnings = [],
    ): void {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => $warnings,
            ]),
        ]);
    }

    private function runImport(Document $document): void
    {
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));
    }
}
