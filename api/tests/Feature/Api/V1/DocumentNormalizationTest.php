<?php

namespace Tests\Feature\Api\V1;

use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\User;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\DocumentImporter;
use App\Services\Import\Normalization\ImportWarning;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use Throwable;

/**
 * Normalization (SPEC 5.2) over the API HTTP seam: HTML converts to markdown,
 * referenced images are re-hosted to the media disk, and a failed image fetch
 * surfaces as an author-facing warning without failing the import — all as
 * observable API state (the poll payload and the media disk), never job
 * internals. The guarded fetcher is faked at its boundary and routed by URL so
 * one import exercises both the document fetch and its image fetches.
 */
class DocumentNormalizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_html_source_is_converted_to_markdown_and_images_rehosted(): void
    {
        Queue::fake();
        Storage::fake('public');
        $this->fakeProjection();

        $docUrl = 'https://blog.example.test/post.html';
        $imgUrl = 'https://cdn.example.test/diagram.png';
        $png = 'PNG-IMAGE-BYTES';
        $html = '<!DOCTYPE html><html><head><title>Post</title>'
            .'<style>body{color:red}</style><script>alert(1)</script></head><body>'
            .'<h1>Imported Post</h1>'
            .'<p style="color:red" onclick="steal()">Body <strong>text</strong>.</p>'
            .'<img src="'.$imgUrl.'" alt="Diagram" onerror="x()">'
            .'<table><thead><tr><th>A</th><th>B</th></tr></thead>'
            .'<tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
            .'</body></html>';

        $this->fakeFetchMap([
            $docUrl => new FetchResult(200, $html, 'text/html', $docUrl),
            $imgUrl => new FetchResult(200, $png, 'image/png', $imgUrl),
        ]);

        $user = $this->registerUser();
        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => $docUrl])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        $poll = $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}");

        $poll->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('format', 'html')
            ->assertJsonPath('title', 'Imported Post')
            ->assertJsonPath('current_version.import_warnings', []);

        $content = (string) $poll->json('current_version.content');

        // Converted to markdown: heading, GFM table, emphasis survive.
        $this->assertStringContainsString('# Imported Post', $content);
        $this->assertStringContainsString('| A | B |', $content);
        $this->assertStringContainsString('**text**', $content);

        // Hostile surface gone.
        $this->assertStringNotContainsString('alert(1)', $content);
        $this->assertStringNotContainsString('onclick', $content);
        $this->assertStringNotContainsString('color:red', $content);

        // Image re-hosted: original origin gone, served from /storage.
        $this->assertStringNotContainsString('cdn.example.test', $content);
        $storedPath = 'media/'.$document->id.'/'.hash('sha256', $png).'.png';
        Storage::disk('public')->assertExists($storedPath);
        $this->assertStringContainsString('/storage/'.$storedPath, $content);
    }

    public function test_a_broken_image_becomes_a_warning_and_the_import_still_succeeds(): void
    {
        Queue::fake();
        Storage::fake('public');
        $this->fakeProjection();

        $docUrl = 'https://raw.example.test/notes.md';
        $imgUrl = 'https://cdn.example.test/missing.png';
        $markdown = "# Notes\n\nSee the ![chart]({$imgUrl}) below.\n";

        $this->fakeFetchMap([
            $docUrl => new FetchResult(200, $markdown, 'text/markdown', $docUrl),
            $imgUrl => new UpstreamFetchException('host unreachable'),
        ]);

        $user = $this->registerUser();
        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => $docUrl])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        $poll = $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}");

        // The import lands despite the broken image (SPEC §19).
        $poll->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('format', 'md')
            ->assertJsonPath('current_version.import_warnings.0.type', ImportWarning::IMAGE_FETCH_FAILED);

        $warnings = $poll->json('current_version.import_warnings');
        $this->assertCount(1, $warnings);
        $this->assertStringContainsString($imgUrl, $warnings[0]['message']);

        // The original image URL is kept so it may still resolve for the reader.
        $this->assertStringContainsString($imgUrl, (string) $poll->json('current_version.content'));
        $this->assertEmpty(Storage::disk('public')->allFiles('media/'.$document->id));
    }

    public function test_relative_links_absolutize_against_a_github_blob_source_and_compose_with_image_rehosting(): void
    {
        Queue::fake();
        Storage::fake('public');
        $this->fakeProjection();

        // A GitHub blob source: the connector fetches the contents API but reports
        // the human blob URL as finalUrl, so siblings resolve to blob URLs (#50).
        $blobUrl = 'https://github.com/octocat/hello/blob/main/docs/rfc.md';
        $contentsApi = 'https://api.github.com/repos/octocat/hello/contents/docs/rfc.md?ref=main';
        // The relative image resolves against the same blob base before it is fetched.
        $imageBlobUrl = 'https://github.com/octocat/hello/blob/main/docs/diagram.png';
        $png = 'PNG-DIAGRAM-BYTES';

        $markdown = "# RFC\n\n"
            ."See the [sibling](./other.md) and the [parent](../CONTRIBUTING.md).\n\n"
            .'A [fragment](#intro), an [absolute](https://example.com/x), and '
            ."an ![diagram](./diagram.png).\n\n"
            .'[ref]: ./reference.md';

        $this->fakeFetchMap([
            $contentsApi => new FetchResult(200, $markdown, 'text/plain', $contentsApi),
            $imageBlobUrl => new FetchResult(200, $png, 'image/png', $imageBlobUrl),
        ]);

        $user = $this->registerUser();
        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', ['url' => $blobUrl])
            ->assertStatus(202);

        $document = Document::sole();
        $this->runImport($document);

        $content = (string) $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('format', 'md')
            ->json('current_version.content');

        // Relative links (inline + reference) resolve to sibling blob URLs.
        $this->assertStringContainsString('[sibling](https://github.com/octocat/hello/blob/main/docs/other.md)', $content);
        $this->assertStringContainsString('[parent](https://github.com/octocat/hello/blob/main/CONTRIBUTING.md)', $content);
        $this->assertStringContainsString('[ref]: https://github.com/octocat/hello/blob/main/docs/reference.md', $content);
        $this->assertStringNotContainsString('](./other.md)', $content);

        // Self-locating hrefs are left alone.
        $this->assertStringContainsString('[fragment](#intro)', $content);
        $this->assertStringContainsString('[absolute](https://example.com/x)', $content);

        // Composes with image re-hosting: the image was rehosted (not link-rewritten).
        $storedPath = 'media/'.$document->id.'/'.hash('sha256', $png).'.png';
        Storage::disk('public')->assertExists($storedPath);
        $this->assertStringContainsString('![diagram](/storage/'.$storedPath.')', $content);
        $this->assertStringNotContainsString('./diagram.png', $content);
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
     * Fake the guarded fetcher and route each call by URL to a scripted
     * FetchResult (or a thrown exception). Extra fetch arguments (the per-call
     * size cap) are ignored.
     *
     * @param  array<string, FetchResult|Throwable>  $map
     */
    private function fakeFetchMap(array $map): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')->andReturnUsing(
                function (string $url) use ($map) {
                    $outcome = $map[$url] ?? throw new \RuntimeException("unexpected fetch: {$url}");

                    if ($outcome instanceof Throwable) {
                        throw $outcome;
                    }

                    return $outcome;
                },
            ),
        );
    }

    private function runImport(Document $document): void
    {
        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));
    }

    // The importer projects every version after normalization (#18); these
    // tests fake that endpoint at its HTTP boundary like DocumentImportTest.
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
