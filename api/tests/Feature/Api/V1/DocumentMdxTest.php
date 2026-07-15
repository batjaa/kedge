<?php

namespace Tests\Feature\Api\V1;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\User;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\DocumentImporter;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * The MDX slice of the import flow (SPEC 6.1, #20), as observable API state: an
 * `.mdx` source is detected and routed through the MDX path, the projection
 * endpoint's real `mdx_ok` lands on the version, and a compile failure is a
 * recorded degradation (fallback), never an import failure. The projection
 * endpoint is faked at its HTTP boundary; the guarded fetcher is faked in the
 * container (testing decision 1).
 */
class DocumentMdxTest extends TestCase
{
    use RefreshDatabase;

    private const MDX_URL = 'https://raw.githubusercontent.com/kedgehq/kedge/main/rfc.mdx';

    private const MD_URL = 'https://raw.githubusercontent.com/kedgehq/kedge/main/README.md';

    public function test_mdx_url_is_detected_and_projected_as_mdx(): void
    {
        $this->fakeFetchReturns("# RFC\n\n<Callout>hi</Callout>\n", self::MDX_URL);
        $this->fakeProjection(mdxOk: true);

        $document = $this->importFrom(self::MDX_URL);

        $this->assertSame(DocumentFormat::Mdx, $document->format);
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertTrue($document->currentVersion->mdx_ok);

        // The importer must send the DETECTED format (mdx), not the creation-time
        // default (md) — otherwise the endpoint never runs the MDX compile.
        Http::assertSent(
            fn ($request) => str_ends_with($request->url(), '/internal/projection')
                && $request['format'] === 'mdx',
        );
    }

    public function test_mdx_compile_failure_marks_version_and_logs_event(): void
    {
        Log::spy();
        $this->fakeFetchReturns("import x from 'y'\n\n# RFC\n", self::MDX_URL);
        $this->fakeProjection(mdxOk: false, warnings: ['MDX failed to compile: rejected']);

        $document = $this->importFrom(self::MDX_URL);

        // A rejected MDX doc still imports — it renders as plain-markdown
        // fallback — so the document is Ready with mdx_ok=false, not failed.
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertFalse($document->currentVersion->mdx_ok);

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => $message === 'mdx.compile_failed'
                && $context['document_id'] === $document->id);
    }

    public function test_markdown_document_stores_null_mdx_ok(): void
    {
        $this->fakeFetchReturns("# Plain\n\nMarkdown.\n", self::MD_URL);
        $this->fakeProjection(mdxOk: true);

        $document = $this->importFrom(self::MD_URL);

        $this->assertSame(DocumentFormat::Md, $document->format);
        // mdx_ok is not applicable to markdown → null, never a spurious true.
        $this->assertNull($document->currentVersion->mdx_ok);
    }

    public function test_version_resource_exposes_mdx_ok(): void
    {
        $user = $this->registerUser();
        $this->fakeFetchReturns("# RFC\n\ntext\n", self::MDX_URL);
        $this->fakeProjection(mdxOk: false);

        $document = $this->importFrom(self::MDX_URL, $user);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('format', 'mdx')
            ->assertJsonPath('current_version.mdx_ok', false);
    }

    // --- helpers ------------------------------------------------------------

    private function importFrom(string $url, ?User $user = null): Document
    {
        $user ??= $this->registerUser();

        $document = Document::create([
            'workspace_id' => $user->personalWorkspace()->id,
            'created_by' => $user->id,
            'source_type' => SourceType::RawUrl,
            'source_url' => $url,
            'title' => 'pending',
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
        ]);

        (new ImportDocumentJob($document))->handle(app(DocumentImporter::class));

        return $document->fresh(['currentVersion']);
    }

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

    /**
     * @param  list<string>  $warnings
     */
    private function fakeProjection(bool $mdxOk, array $warnings = []): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => 'Projected text.',
                'projection_version' => '1',
                'mdx_ok' => $mdxOk,
                'warnings' => $warnings,
            ]),
        ]);
    }
}
