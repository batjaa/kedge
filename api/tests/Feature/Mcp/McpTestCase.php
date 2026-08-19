<?php

namespace Tests\Feature\Mcp;

use App\Models\AgentToken;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Models\Workspace;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\NewAccessToken;
use Tests\Feature\Api\V1\McpEndpointTest;
use Tests\TestCase;

/**
 * Shared fixtures for the MCP tool suite (SPEC §15, #135).
 *
 * The tools are exercised in-process through laravel/mcp's testing utilities,
 * which is the seam the module spec names: it runs the real server, the real
 * tool, the real Policies and the real services, and skips only the JSON-RPC
 * transport (which {@see McpEndpointTest} covers over
 * HTTP instead).
 *
 * Every principal here is built with factories and `actingAs`, never by making
 * a request first: switching actors after an HTTP round trip leaves the
 * resolved guard stuck on the earlier one, which turns an expected denial into
 * a misleading 401.
 */
abstract class McpTestCase extends TestCase
{
    use RefreshDatabase;

    protected User $operator;

    protected Workspace $workspace;

    protected Document $document;

    protected DocumentVersion $version;

    /**
     * The plain-text projection every anchor in these tests is measured against.
     */
    protected const PLAIN_TEXT = 'Anchors survive versions. That is the moat.';

    protected function setUp(): void
    {
        parent::setUp();

        $this->operator = app(RegistrationService::class)->register(
            name: 'Agent Operator',
            email: 'operator@example.com',
            password: 'correct-horse-battery',
        );
        $this->workspace = $this->operator->personalWorkspace();
        [$this->document, $this->version] = $this->readyDocument($this->workspace, 'RFC 017 — Anchoring');
    }

    /**
     * @return array{Document, DocumentVersion}
     */
    protected function readyDocument(Workspace $workspace, string $title, ?User $author = null): array
    {
        $author ??= $this->operator;
        $content = "# {$title}\n\n".self::PLAIN_TEXT."\n";

        $document = Document::factory()
            ->for($workspace, 'workspace')
            ->ready()
            ->create(['title' => $title, 'created_by' => $author->id]);

        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content.$title),
            'plain_text' => self::PLAIN_TEXT,
            'projection_version' => (string) config('kedge.projection.current_version'),
        ]);

        $document->forceFill(['current_version_id' => $version->id])->save();

        return [$document->refresh(), $version];
    }

    /**
     * The operator, acting through an agent token scoped to one workspace —
     * exactly what `auth:sanctum` hands the tools on a real MCP request.
     */
    protected function agentFor(?Workspace $workspace = null, ?User $owner = null): User
    {
        $owner ??= $this->operator;
        $issued = $this->issueToken($workspace ?? $this->workspace, $owner);

        return $owner->fresh()->withAccessToken($issued->accessToken);
    }

    protected function issueToken(?Workspace $workspace = null, ?User $owner = null): NewAccessToken
    {
        $owner ??= $this->operator;

        return $owner->createToken(
            'Claude Code',
            [AgentToken::workspaceAbility(($workspace ?? $this->workspace)->id)],
        );
    }

    /**
     * A well-formed anchor over {@see PLAIN_TEXT} — the shape a browser's
     * capture produces and the shape an agent has to reconstruct from
     * `version.plain_text`.
     *
     * @return array<string, mixed>
     */
    protected function anchorPayload(string $exact = 'survive versions'): array
    {
        $start = mb_strpos(self::PLAIN_TEXT, $exact);

        return [
            'exact' => $exact,
            'prefix' => mb_substr(self::PLAIN_TEXT, 0, $start),
            'suffix' => '',
            'start' => $start,
            'end' => $start + mb_strlen($exact),
            'heading_path' => ['RFC 017 — Anchoring'],
            'projection_version' => (string) config('kedge.projection.current_version'),
        ];
    }

    /**
     * The web layer's internal projection endpoint (SPEC §5.4), faked. The
     * anchor capture path re-projects whenever a selector fails to match, so any
     * test that exercises a mismatch has to stand one up — for an agent's anchor
     * exactly as for a browser's.
     */
    protected function fakeProjection(string $plainText, ?string $version = null): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version ?? (string) config('kedge.projection.current_version'),
                'mdx_ok' => true,
                'warnings' => [],
            ]),
        ]);
    }

    protected function threadOn(Document $document, ?User $author = null, string $body = 'An existing point.'): Thread
    {
        $author ??= $this->operator;

        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $author->id,
        ]);

        $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => $body,
        ]);

        return $thread;
    }
}
