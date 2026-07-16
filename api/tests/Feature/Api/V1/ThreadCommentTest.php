<?php

namespace Tests\Feature\Api\V1;

use App\Enums\WorkspaceRole;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ThreadCommentTest extends TestCase
{
    use RefreshDatabase;

    public function test_author_creates_inline_and_document_threads_replies_and_lists_in_position_order(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: "Intro\n\nFirst target paragraph.\n\nSecond target paragraph.",
        );

        $inline = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Inline comment',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'Second target', '2'),
            ]);

        $inline->assertCreated()
            ->assertJsonPath('type', 'inline')
            ->assertJsonPath('anchor.exact', 'Second target')
            ->assertJsonPath('first_comment.body_md', 'Inline comment');

        $documentLevel = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Whole document comment',
            ]);

        $documentLevel->assertCreated()
            ->assertJsonPath('type', 'document')
            ->assertJsonPath('anchor', null);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$inline->json('id')}/comments", [
                'body' => 'Reply on inline thread',
                'idempotency_key' => 'reply-inline-1',
            ])
            ->assertCreated()
            ->assertJsonPath('body_md', 'Reply on inline thread');

        $list = $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads");

        $list->assertOk()
            ->assertJsonPath('data.0.type', 'document')
            ->assertJsonPath('data.0.first_comment.body_md', 'Whole document comment')
            ->assertJsonPath('data.1.type', 'inline')
            ->assertJsonPath('data.1.anchor.exact', 'Second target')
            ->assertJsonPath('data.1.comment_count', 2);

        $this->assertDatabaseHas('audit_logs', ['action' => 'thread.created']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'comment.created']);
        $this->assertDatabaseCount('threads', 2);
        $this->assertDatabaseCount('comments', 3);
        $this->assertDatabaseCount('anchors', 1);
    }

    public function test_inline_anchor_exact_mismatch_is_rejected_with_a_clear_code(): void
    {
        [$author, $document] = $this->readyDocument(plainText: 'Alpha target text');
        $this->fakeProjection($document->currentVersion->plain_text, '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Broken anchor',
                'anchor' => [
                    ...$this->anchorFor($document->currentVersion->plain_text, 'target', '2'),
                    'exact' => 'different',
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'anchor_exact_mismatch');

        $this->assertDatabaseCount('threads', 0);
    }

    public function test_stale_projection_self_heals_before_anchor_validation(): void
    {
        [$author, $document] = $this->readyDocument(
            content: '# Doc',
            plainText: 'Alpha old text',
            projectionVersion: '1',
        );
        $this->fakeProjection('Alpha fresh text', '2');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Fresh anchor',
                'anchor' => $this->anchorFor('Alpha fresh text', 'fresh', '1'),
            ])
            ->assertCreated()
            ->assertJsonPath('anchor.exact', 'fresh')
            ->assertJsonPath('anchor.projection_version', '2');

        $document->currentVersion->refresh();
        $this->assertSame('Alpha fresh text', $document->currentVersion->plain_text);
        $this->assertSame('2', $document->currentVersion->projection_version);
        $this->assertDatabaseHas('anchors', ['exact' => 'fresh', 'projection_version' => '2']);
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/projection'));
    }

    public function test_reply_idempotency_key_returns_the_original_comment(): void
    {
        [$author, $document] = $this->readyDocument();

        $thread = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Parent',
            ])
            ->assertCreated();

        $first = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply once',
                'idempotency_key' => 'reply-once',
            ])
            ->assertCreated();

        $retry = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->json('id')}/comments", [
                'body' => 'Reply once',
                'idempotency_key' => 'reply-once',
            ])
            ->assertOk();

        $this->assertSame($first->json('id'), $retry->json('id'));
        $this->assertDatabaseCount('comments', 2);
    }

    public function test_demo_document_rejects_thread_creation_until_claimed(): void
    {
        $author = $this->registerUser();
        $document = Document::factory()->demo()->ready()->create();
        $author->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);
        $this->attachVersion($document);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'No owner yet',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'demo_document_unclaimed');
    }

    public function test_thread_write_endpoint_is_rate_limited(): void
    {
        [$author, $document] = $this->readyDocument();

        for ($i = 0; $i < 30; $i++) {
            $this->actingAs($author)->fromWebApp()
                ->postJson("/api/v1/documents/{$document->id}/threads", [])
                ->assertUnprocessable();
        }

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [])
            ->assertTooManyRequests();
    }

    public function test_thread_list_is_paginated_at_the_database(): void
    {
        [$author, $document] = $this->readyDocument();

        for ($i = 1; $i <= 25; $i++) {
            $this->actingAs($author)->fromWebApp()
                ->postJson("/api/v1/documents/{$document->id}/threads", [
                    'type' => 'document',
                    'body' => "Thread {$i}",
                ])
                ->assertCreated();
        }

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10&page=2")
            ->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.per_page', 10)
            ->assertJsonPath('meta.total', 25);
    }

    /**
     * @return array{User, Document}
     */
    private function readyDocument(
        string $content = "# Doc\n\nAlpha target text",
        string $plainText = 'Alpha target text',
        string $projectionVersion = '2',
    ): array {
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $author->id]);
        $this->attachVersion($document, $content, $plainText, $projectionVersion);

        return [$author, $document->refresh()];
    }

    private function attachVersion(
        Document $document,
        string $content = "# Doc\n\nAlpha target text",
        string $plainText = 'Alpha target text',
        string $projectionVersion = '2',
    ): DocumentVersion {
        $version = DocumentVersion::factory()
            ->for($document)
            ->create([
                'content_raw' => $content,
                'content_normalized' => $content,
                'content_hash' => hash('sha256', $content),
                'plain_text' => $plainText,
                'projection_version' => $projectionVersion,
            ]);

        $document->forceFill(['current_version_id' => $version->id])->save();
        $document->setRelation('currentVersion', $version);

        return $version;
    }

    /**
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function anchorFor(string $plainText, string $exact, string $projectionVersion): array
    {
        $start = mb_strpos($plainText, $exact, 0, 'UTF-8');
        $this->assertNotFalse($start);
        $end = $start + mb_strlen($exact, 'UTF-8');

        return [
            'exact' => $exact,
            'prefix' => mb_substr($plainText, max(0, $start - 8), min(8, $start), 'UTF-8'),
            'suffix' => mb_substr($plainText, $end, 8, 'UTF-8'),
            'start' => $start,
            'end' => $end,
            'heading_path' => ['Doc'],
            'projection_version' => $projectionVersion,
        ];
    }

    private function fakeProjection(string $plainText, string $version): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => [],
            ]),
        ]);
    }

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
