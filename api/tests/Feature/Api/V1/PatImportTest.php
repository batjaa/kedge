<?php

namespace Tests\Feature\Api\V1;

use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\Integration;
use App\Models\User;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\Import\DocumentImporter;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The PAT import lifecycle end to end over the API + queue (ticket #23). When the
 * workspace has a connected token, a github.com blob URL is imported through the
 * authenticated connector — private files land, the token rides the wire — and a
 * 401 becomes a terminal, reconnect-CTA failure (SPEC §19), never a retry. Only
 * the HTTP boundary is faked (a recorded private-file body / 401); the connector,
 * guarded fetcher, importer, and job are all real.
 */
class PatImportTest extends TestCase
{
    use RefreshDatabase;

    private const BLOB_URL = 'https://github.com/acme/private-specs/blob/main/rfc/042-widget.md';

    private const TOKEN = 'ghp_e2eSECRETtoken2222222222222222mnop';

    public function test_a_workspace_with_a_pat_imports_a_github_url_authenticated(): void
    {
        Queue::fake();
        // Fake the HTTP boundary BEFORE the connector registry is first resolved
        // (it is a singleton whose connectors capture the transport at build time,
        // which the POST below triggers) — otherwise the import would hit the wire.
        $this->fakeGithub(200, ['Content-Type' => 'text/plain'], "# Private RFC 042\n\nBody.\n");
        $this->fakeProjection();
        $transport = $this->boundTransport();

        $user = $this->registerUser();
        Integration::factory()->withToken(self::TOKEN)
            ->for($user->personalWorkspace())
            ->create();

        // Create: the github URL is upgraded to the authenticated connector, and
        // the integration is bound to the document.
        $create = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::BLOB_URL]);

        $create->assertStatus(202)
            ->assertJsonPath('source_type', 'github_pat');

        $document = Document::sole();
        $this->assertSame(SourceType::GithubPat, $document->source_type);
        $this->assertNotNull($document->integration_id);

        // Import: the connector fetches the private file with the token on the
        // Authorization header, through the guarded (pinned) fetcher.
        $this->runImport($document);

        $document->refresh();
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertSame("# Private RFC 042\n\nBody.\n", $document->currentVersion->content_raw);

        // The outbound request authenticated with the workspace's token.
        $this->assertSame('Bearer '.self::TOKEN, $transport->lastRequest()->headers['Authorization']);
    }

    public function test_a_revoked_token_fails_the_document_terminally_with_a_reconnect_message(): void
    {
        Queue::fake();
        // GitHub rejects the token with 401 — faked before the registry resolves,
        // so no real request escapes. The guarded fetch returns it, the connector
        // raises TokenRevokedException, the job marks the doc failed.
        $this->fakeGithub(401, ['Content-Type' => 'application/json'], '{"message":"Bad credentials"}');

        $user = $this->registerUser();
        Integration::factory()->withToken(self::TOKEN)
            ->for($user->personalWorkspace())
            ->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::BLOB_URL])
            ->assertStatus(202);

        $document = Document::sole();

        // Terminal: the job must NOT rethrow (no retry) — handle() swallows it like
        // a blocked URL, marking the document failed once.
        $job = (new ImportDocumentJob($document))->withFakeQueueInteractions();
        $job->handle(app(DocumentImporter::class));
        $job->assertNotReleased();
        $job->assertNotFailed();

        $document->refresh();
        $this->assertSame(DocumentStatus::Failed, $document->status);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertSame(
            'GitHub token was revoked or lacks access — reconnect the integration.',
            $document->sync_error,
        );
        // A first import that never produced a version — nothing to keep.
        $this->assertNull($document->current_version_id);

        // Observable to the web: the failed poll response carries the reconnect copy.
        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('status', 'failed')
            ->assertJsonPath('sync_error', 'GitHub token was revoked or lacks access — reconnect the integration.');
    }

    public function test_the_pat_never_reaches_the_logs_across_a_full_import(): void
    {
        Queue::fake();
        $this->fakeGithub(200, ['Content-Type' => 'text/plain'], "# Private RFC 042\n\nBody.\n");
        $this->fakeProjection();

        $user = $this->registerUser();
        Integration::factory()->withToken(self::TOKEN)
            ->for($user->personalWorkspace())
            ->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => self::BLOB_URL])
            ->assertStatus(202);

        // Capture everything the import logs (import.started / import.completed, and
        // the SSRF guard along the way) and prove the token appears in none of it.
        $captured = [];
        Log::listen(function ($message) use (&$captured) {
            $captured[] = $message->message.' '.json_encode($message->context);
        });

        $this->runImport(Document::sole());

        // The import did log (started + completed) — the assertion below is real.
        $this->assertNotEmpty($captured);
        foreach ($captured as $line) {
            $this->assertStringNotContainsString(self::TOKEN, $line, 'A log line leaked the PAT.');
        }
    }

    // --- helpers ------------------------------------------------------------

    private function registerUser(): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: 'author@example.com',
            password: 'correct-horse-battery',
        );
    }

    /**
     * Wire the guarded fetcher to a faked HTTP boundary replaying one GitHub
     * response, and pin api.github.com to a public address. Returns nothing; use
     * {@see boundTransport()} to read the recorded request afterwards.
     *
     * @param  array<string, string>  $headers
     */
    private function fakeGithub(int $status, array $headers, string $body): void
    {
        $dns = new FakeDnsResolver;
        $dns->set('api.github.com', ['140.82.112.3']);

        $transport = new FakeHttpTransport;
        $transport->respond($status, $headers, $body);

        $this->app->instance(DnsResolver::class, $dns);
        $this->app->instance(HttpTransport::class, $transport);
    }

    private function boundTransport(): FakeHttpTransport
    {
        return $this->app->make(HttpTransport::class);
    }

    private function fakeProjection(): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => 'Private RFC 042 Body.',
                'projection_version' => '1',
                'mdx_ok' => true,
                'warnings' => [],
            ]),
        ]);
    }

    private function runImport(Document $document): void
    {
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));
    }
}
