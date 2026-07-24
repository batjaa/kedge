<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AuditEvent;
use App\Models\AuditLog;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * M3.8 #108 — review-side audit instrumentation: the display snapshot written at
 * event time (2A) and the hard rule that a dead audit sink never fails the domain
 * action it trails (AC #4; SPEC hard rule #6 for comments). The per-write-site
 * "fires from its domain action" coverage lives with each flow's own suite
 * (ThreadComment, Approval, DocumentResync, DocumentImport); this file guards the
 * cross-cutting shape those write sites share.
 */
class AuditInstrumentationTest extends TestCase
{
    use RefreshDatabase;

    public function test_thread_and_comment_creation_snapshot_display_context_into_meta(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: "Intro\n\nFirst target paragraph.",
        );

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Inline comment',
                'idempotency_key' => 'inline-first',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'First target', '2'),
            ])
            ->assertCreated();

        // The feed row renders from the row alone: doc title, the section the
        // thread sits on, and the actor's name are frozen into meta at write time.
        foreach ([AuditEvent::ThreadCreated, AuditEvent::CommentCreated] as $event) {
            $entry = AuditLog::query()->where('action', $event->value)->sole();
            $this->assertSame($document->title, $entry->meta['document_title']);
            $this->assertSame('Doc', $entry->meta['section']);
            $this->assertSame($author->name, $entry->meta['actor_name']);
        }
    }

    public function test_a_document_level_thread_snapshots_no_section(): void
    {
        [$author, $document] = $this->readyDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Whole document comment',
                'idempotency_key' => 'document-first',
            ])
            ->assertCreated();

        $entry = AuditLog::query()->where('action', AuditEvent::ThreadCreated->value)->sole();
        $this->assertSame($document->title, $entry->meta['document_title']);
        // A document-level thread has no section — the key is dropped, not stored null.
        $this->assertArrayNotHasKey('section', $entry->meta);
    }

    public function test_a_deleted_subject_still_renders_from_the_snapshot(): void
    {
        [$author, $document] = $this->readyDocument(
            plainText: "Intro\n\nFirst target paragraph.",
        );

        $threadId = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'inline',
                'body' => 'Inline comment',
                'idempotency_key' => 'inline-first',
                'anchor' => $this->anchorFor($document->currentVersion->plain_text, 'First target', '2'),
            ])
            ->assertCreated()
            ->json('id');

        $comment = Comment::query()->where('thread_id', $threadId)->sole();
        $entry = AuditLog::query()
            ->where('action', AuditEvent::CommentCreated->value)
            ->where('subject_id', $comment->id)
            ->sole();

        // Delete the very subject the row points at. Morph hydration would now find
        // a tombstone, but the sentence must still render — from the snapshot.
        $comment->forceDelete();

        $entry->refresh();
        $this->assertNull($entry->subject);
        $this->assertSame($document->title, $entry->meta['document_title']);
        $this->assertSame('Doc', $entry->meta['section']);
        $this->assertSame($author->name, $entry->meta['actor_name']);
    }

    public function test_a_dead_audit_sink_never_fails_comment_creation(): void
    {
        [$author, $document] = $this->readyDocument();

        // Bind the failing logger AFTER registration so onboarding's own writes
        // used the real one. record() throws (a dead trail sink); the real
        // recordSafely swallows and logs it.
        Log::spy();
        $logger = Mockery::mock(AuditLogger::class)->makePartial();
        $logger->shouldReceive('record')->andThrow(new RuntimeException('audit sink down'));
        $this->app->instance(AuditLogger::class, $logger);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'This comment must survive a dead audit sink',
                'idempotency_key' => 'survives-dead-sink',
            ])
            ->assertCreated();

        // Comment persistence never depends on the audit write (SPEC hard rule #6).
        $this->assertDatabaseHas('comments', [
            'body_md' => 'This comment must survive a dead audit sink',
        ]);
        $this->assertSame(0, AuditLog::query()->where('action', AuditEvent::CommentCreated->value)->count());
        Log::shouldHaveReceived('warning')->with('audit.write_failed', Mockery::type('array'));
    }

    public function test_a_dead_audit_sink_never_fails_an_approval(): void
    {
        [$author, $document] = $this->readyDocument();

        Log::spy();
        $logger = Mockery::mock(AuditLogger::class)->makePartial();
        $logger->shouldReceive('record')->andThrow(new RuntimeException('audit sink down'));
        $this->app->instance(AuditLogger::class, $logger);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated();

        // The grant committed even though its post-commit trail write threw.
        $this->assertDatabaseHas('approvals', [
            'document_id' => $document->id,
            'user_id' => $author->id,
            'revoked_at' => null,
        ]);
        $this->assertSame(0, AuditLog::query()->where('action', AuditEvent::ApprovalGiven->value)->count());
        Log::shouldHaveReceived('warning')->with('audit.write_failed', Mockery::type('array'));
    }

    /**
     * @return array{User, Document}
     */
    private function readyDocument(
        string $content = "# Doc\n\nFirst target paragraph.",
        string $plainText = 'First target paragraph.',
        string $projectionVersion = '2',
    ): array {
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $author->id]);

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

        return [$author, $document->refresh()];
    }

    /**
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function anchorFor(string $plainText, string $exact, string $projectionVersion): array
    {
        $codepointStart = mb_strpos($plainText, $exact, 0, 'UTF-8');
        $this->assertNotFalse($codepointStart);
        $start = $this->utf16CodeUnitLength(mb_substr($plainText, 0, $codepointStart, 'UTF-8'));
        $end = $start + $this->utf16CodeUnitLength($exact);

        return [
            'exact' => $exact,
            'prefix' => $this->utf16CodeUnitSlice($plainText, max(0, $start - 8), min(8, $start)),
            'suffix' => $this->utf16CodeUnitSlice($plainText, $end, 8),
            'start' => $start,
            'end' => $end,
            'heading_path' => ['Doc'],
            'projection_version' => $projectionVersion,
        ];
    }

    private function utf16CodeUnitLength(string $value): int
    {
        return intdiv(strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')), 2);
    }

    private function utf16CodeUnitSlice(string $value, int $start, int $length): string
    {
        $utf16 = mb_convert_encoding($value, 'UTF-16LE', 'UTF-8');
        $slice = substr($utf16, $start * 2, $length * 2);

        return mb_convert_encoding($slice, 'UTF-8', 'UTF-16LE');
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
