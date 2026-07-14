<?php

namespace Tests\Feature\Import;

use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\Import\DocumentImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The GitHub rate-limit path end to end (SPEC §19 "GitHub 403/429 → honor
 * Retry-After"). When the public GitHub budget is spent, the import job must back
 * off and resume — release for the honored delay, leave the document `importing`,
 * and not spend a failure — never dead-end. Asserted as observable job + document
 * state through the real importer and guarded fetcher, with only the HTTP boundary
 * faked (a recorded 429 shape).
 */
class RateLimitedImportTest extends TestCase
{
    use RefreshDatabase;

    private const BLOB_URL = 'https://github.com/octocat/Hello-World/blob/master/README.md';

    public function test_a_github_429_releases_the_job_and_keeps_the_document_importing(): void
    {
        $this->fakeGithubResponse(429, ['Retry-After' => '90'], '{"message":"secondary rate limit"}');

        $document = Document::factory()->create([
            'source_type' => SourceType::GithubPublic,
            'source_url' => self::BLOB_URL,
            'status' => DocumentStatus::Importing,
        ]);

        $job = (new ImportDocumentJob($document))->withFakeQueueInteractions();
        $job->handle(app(DocumentImporter::class));

        // Backed off for the honored Retry-After, not failed — "Rate-limited, retrying".
        $job->assertReleased(90);
        $job->assertNotFailed();

        $document->refresh();
        $this->assertSame(DocumentStatus::Importing, $document->status);
        $this->assertNull($document->current_version_id);
        $this->assertNull($document->sync_error);
    }

    /**
     * Wire the guarded fetcher to a faked HTTP boundary that replays one GitHub
     * response. Bound before the connector registry is first resolved, so the
     * GitHub connector's fetcher uses these fakes.
     *
     * @param  array<string, string>  $headers
     */
    private function fakeGithubResponse(int $status, array $headers, string $body): void
    {
        $dns = new FakeDnsResolver;
        $dns->set('api.github.com', ['140.82.112.3']);

        $transport = new FakeHttpTransport;
        $transport->respond($status, $headers, $body);

        $this->app->instance(DnsResolver::class, $dns);
        $this->app->instance(HttpTransport::class, $transport);
    }
}
