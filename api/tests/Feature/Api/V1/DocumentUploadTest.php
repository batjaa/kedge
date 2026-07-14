<?php

namespace Tests\Feature\Api\V1;

use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\User;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\DocumentImporter;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The two no-auth connectors added in #22 over the API HTTP seam (SPEC 5.3): the
 * upload/paste lifecycle (202 → poll → ready, manual-only, no URL) and public
 * GitHub blob-URL routing + lifecycle. External sources are faked at the guarded
 * fetcher; upload needs no fetch at all (the body rides in `source_meta`).
 */
class DocumentUploadTest extends TestCase
{
    use RefreshDatabase;

    private const BLOB_URL = 'https://github.com/octocat/Hello-World/blob/master/README.md';

    // --- Upload / paste -----------------------------------------------------

    public function test_paste_import_accepts_202_then_polls_to_ready(): void
    {
        Queue::fake();
        $user = $this->registerUser();
        $content = "# Pasted Spec\n\nA draft made reviewable before it lives anywhere.\n";

        $create = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['content' => $content]);

        $create->assertStatus(202)
            ->assertJsonPath('status', 'importing')
            ->assertJsonPath('source_type', 'upload')
            ->assertJsonPath('source_url', null);

        $document = Document::sole();
        Queue::assertPushed(ImportDocumentJob::class);

        $this->runImport($document);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('source_type', 'upload')
            ->assertJsonPath('title', 'Pasted Spec') // synthesized from the heading
            ->assertJsonPath('current_version.content', $content)
            ->assertJsonPath('current_version.content_hash', hash('sha256', $content));

        $this->assertDatabaseCount('document_versions', 1);
    }

    public function test_paste_uses_an_explicit_title_when_given(): void
    {
        Queue::fake();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [
                'content' => "No heading here, just a paragraph.\n",
                'title' => 'Q3 Launch Plan',
            ])
            ->assertStatus(202)
            ->assertJsonPath('title', 'Q3 Launch Plan'); // honored immediately

        $document = Document::sole();
        $this->runImport($document);

        $this->assertSame('Q3 Launch Plan', $document->fresh()->title);
    }

    public function test_paste_content_over_the_size_cap_is_rejected(): void
    {
        config(['kedge.import.max_paste_bytes' => 32]);
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['content' => str_repeat('x', 64)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('content');

        $this->assertDatabaseCount('documents', 0);
    }

    public function test_url_and_content_are_mutually_exclusive(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [
                'url' => 'https://example.com/spec.md',
                'content' => '# Nope',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->assertDatabaseCount('documents', 0);
    }

    // --- Public GitHub ------------------------------------------------------

    public function test_github_blob_url_imports_as_github_public(): void
    {
        Queue::fake();
        $raw = "# Hello-World\n\nRendered from a public GitHub blob.\n";
        $this->fakeFetchReturns($raw, finalUrl: self::BLOB_URL);
        $user = $this->registerUser();

        $create = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::BLOB_URL]);

        $create->assertStatus(202)
            ->assertJsonPath('source_type', 'github_public') // routed to GitHub, not raw
            ->assertJsonPath('source_url', self::BLOB_URL);

        $document = Document::sole();
        $this->runImport($document);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('title', 'Hello-World')
            ->assertJsonPath('current_version.content', $raw);
    }

    public function test_raw_github_user_content_routes_to_the_raw_connector(): void
    {
        Queue::fake();
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [
                'url' => 'https://raw.githubusercontent.com/octocat/Hello-World/master/README.md',
            ])
            ->assertStatus(202)
            ->assertJsonPath('source_type', 'raw_url');
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

    private function fakeFetchReturns(string $body, string $finalUrl): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')
                ->andReturn(new FetchResult(200, $body, 'text/plain', $finalUrl)),
        );
    }

    private function runImport(Document $document): void
    {
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));
    }
}
