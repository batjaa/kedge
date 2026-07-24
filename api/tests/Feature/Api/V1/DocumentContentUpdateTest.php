<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Enums\WorkspaceRole;
use App\Jobs\ResyncDocumentJob;
use App\Models\Anchor;
use App\Models\Approval;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Share;
use App\Models\ShareParticipant;
use App\Models\Thread;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Manual content update for a pasted/uploaded document (#113): an author
 * re-pastes the body and gets a new version through the SAME ResyncDocumentJob
 * pipeline a URL re-sync uses — normalization, content-hash dedupe, re-anchor
 * ladder, approval staleness, one re-anchor digest — so comments survive. The
 * three seams the resync path proves (DocumentResyncTest) are the pipeline; this
 * suite proves the upload TRIGGER rides them, that a URL document is refused (it
 * keeps Re-sync), that the paste size cap gates the body, and that a failed
 * update never disturbs the current version.
 */
class DocumentContentUpdateTest extends TestCase
{
    use RefreshDatabase;

    private const NEW_CONTENT = "# Doc\n\nAlpha survives.\n\nGamma new.\n";

    public function test_author_update_persists_new_source_meta_and_dispatches_the_resync_job(): void
    {
        Queue::fake();
        [$author, $document] = $this->uploadDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(202)
            ->assertJsonPath('status', 'ready');

        // source_meta now holds the LATEST paste, so a queued re-import — including
        // a retry after a transient failure — re-imports this body, not the old one.
        $document->refresh();
        $this->assertSame(self::NEW_CONTENT, $document->source_meta['content']);

        Queue::assertPushed(
            ResyncDocumentJob::class,
            fn (ResyncDocumentJob $job) => $job->document->is($document) && $job->actorId === $author->id,
        );
    }

    public function test_content_update_preserves_the_authors_existing_title(): void
    {
        // This surface versions the body, not the name: an author-set title
        // survives a content update rather than being dropped or overwritten.
        Queue::fake();
        [$author, $document] = $this->uploadDocument(sourceMeta: ['content' => "# Old\n\nOld.\n", 'title' => 'Author title']);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(202);

        $document->refresh();
        $this->assertSame(self::NEW_CONTENT, $document->source_meta['content']);
        $this->assertSame('Author title', $document->source_meta['title']);
    }

    public function test_a_prior_failed_status_is_cleared_before_the_new_attempt_dispatches(): void
    {
        // A doc left FAILED by an earlier update must reset to Ok before dispatch
        // (like retry(), SPEC §19), so the web's completion poll never reads the
        // stale failure as this attempt's outcome.
        Queue::fake();
        [$author, $document] = $this->uploadDocument();
        $document->forceFill([
            'last_sync_status' => SyncStatus::Failed,
            'sync_error' => 'A previous update failed.',
        ])->save();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(202)
            ->assertJsonPath('last_sync_status', 'ok')
            ->assertJsonPath('sync_error', null);

        $document->refresh();
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertNull($document->sync_error);
    }

    public function test_update_works_even_when_the_resync_rollout_flag_is_off(): void
    {
        // Manual content update is an upload's ONLY versioning path and spawns no
        // outbound fetch, so it is deliberately not behind resync.enabled (which
        // gates the URL re-sync route to bound fetch/queue load).
        Queue::fake();
        config(['kedge.resync.enabled' => false]);
        [$author, $document] = $this->uploadDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(202);

        Queue::assertPushed(ResyncDocumentJob::class);
    }

    public function test_a_url_document_cannot_have_its_content_updated(): void
    {
        Queue::fake();
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create([
                'created_by' => $author->id,
                'source_type' => SourceType::RawUrl,
                'source_url' => 'https://raw.example.test/spec.md',
            ]);
        $this->attachVersion($document, "# Doc\n\nText.\n", 'Text.');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(409);

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_a_document_that_never_landed_a_version_cannot_be_updated(): void
    {
        Queue::fake();
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->create([
                'created_by' => $author->id,
                'source_type' => SourceType::Upload,
                'source_url' => null,
                'source_meta' => ['content' => "# Old\n\nOld.\n"],
                'status' => DocumentStatus::Importing,
            ]);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(409);

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_a_non_member_of_the_workspace_is_forbidden(): void
    {
        Queue::fake();
        [, $document] = $this->uploadDocument();
        $stranger = $this->registerUser('stranger@example.com');

        $this->actingAs($stranger)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertForbidden();

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_a_magic_link_reviewer_cannot_update_content(): void
    {
        // A verified share reviewer can read/comment/approve but holds no
        // workspace membership — the resync policy (memberOf) refuses the mutation.
        Queue::fake();
        [, $document, $current] = $this->uploadDocument();
        $reviewer = User::factory()->create(['password' => null]);
        $share = Share::factory()->for($document)->create();
        ShareParticipant::create([
            'share_id' => $share->id,
            'user_id' => $reviewer->id,
            'verified_at' => now(),
        ]);
        // Silence the unused-var lint; the version anchors the doc.
        $this->assertNotNull($current);

        $this->actingAs($reviewer)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertForbidden();

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_a_same_workspace_non_author_member_is_forbidden(): void
    {
        // Author-only (updateContent policy): a plain workspace member — a future
        // team seat — can review/comment/approve but never re-author the body, so a
        // membership check alone is not enough. Distinguishes updateContent from the
        // membership-gated resync.
        Queue::fake();
        [, $document] = $this->uploadDocument();
        $member = User::factory()->create();
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        $this->actingAs($member)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertForbidden();

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_content_over_the_paste_cap_is_rejected_without_touching_the_document(): void
    {
        Queue::fake();
        config(['kedge.import.max_paste_bytes' => 32]);
        [$author, $document] = $this->uploadDocument(sourceMeta: ['content' => "# Old\n\nOld.\n"]);
        $original = $document->source_meta;

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", [
                'content' => str_repeat('x', 64),
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('content');

        // The cap rejects before any write: source_meta is untouched, no job runs.
        $this->assertSame($original, $document->fresh()->source_meta);
        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_missing_content_is_a_validation_error(): void
    {
        Queue::fake();
        [$author, $document] = $this->uploadDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['title' => 'no body'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('content');

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_changed_content_lands_a_new_version_reanchors_threads_and_writes_one_digest(): void
    {
        $oldContent = "# Doc\n\nAlpha survives.\n\nBeta deleted.\n";
        $oldPlain = "Alpha survives.\n\nBeta deleted.";
        $newPlain = "Alpha survives.\n\nGamma new.";
        [$author, $document, $current] = $this->uploadDocument($oldContent, $oldPlain);
        $survives = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Alpha survives.');
        $deleted = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Beta deleted.');

        $this->fakeProjectionAndReanchor($newPlain, [
            [
                'threadId' => $survives->id,
                'state' => 'anchored',
                'exact' => 'Alpha survives.',
                'prefix' => '',
                'suffix' => "\n\nGamma new.",
                'start' => 0,
                'end' => 15,
            ],
            [
                'threadId' => $deleted->id,
                'state' => 'orphaned',
                ...$this->resultFromAnchor($deleted->anchors()->where('document_version_id', $current->id)->firstOrFail()),
            ],
        ]);

        // The synchronous test queue runs ResyncDocumentJob inline during dispatch,
        // so the endpoint drives the whole pipeline end to end.
        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => self::NEW_CONTENT])
            ->assertStatus(202);

        $document->refresh();
        $target = $document->currentVersion;
        $this->assertNotNull($target);
        $this->assertNotSame($current->id, $target->id);
        $this->assertSame($current->id, $target->parent_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);

        // The surviving thread's comment carried onto the new version; the deleted
        // one orphaned but was not lost.
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $survives->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Anchored->value,
        ]);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $deleted->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Orphaned->value,
        ]);

        // Exactly one re-anchor digest for the whole update (M3.8 #110, decision
        // 1A) — the connector on the resync.started row is `upload`, distinguishing
        // a manual content update from a URL re-sync in the trail.
        $this->assertSame(1, AuditLog::query()->where('action', 'reanchor.completed')->count());
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'resync.started',
            'subject_id' => $document->id,
        ]);
        $started = AuditLog::query()->where('action', 'resync.started')->firstOrFail();
        $this->assertSame(SourceType::Upload->value, $started->meta['connector']);
    }

    public function test_identical_content_dedupes_to_no_new_version_and_no_digest(): void
    {
        $content = "# Stable\n\nSame content.\n";
        $plain = "Stable\n\nSame content.";
        [$author, $document, $current] = $this->uploadDocument($content, $plain);
        $this->fakeProjection($plain);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => $content])
            ->assertStatus(202);

        $document->refresh();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertNull($document->sync_error);
        $this->assertDatabaseCount('document_versions', 1);
        // A no-op update produces no anchor movement, so no digest row.
        $this->assertSame(0, AuditLog::query()->where('action', 'reanchor.completed')->count());
        Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/internal/reanchor'));
    }

    public function test_a_flip_marks_prior_active_approvals_gone_stale(): void
    {
        $oldContent = "# Doc\n\nAnchored text.\n";
        $oldPlain = 'Anchored text.';
        $newPlain = 'Anchored text edited.';
        [$author, $document, $current] = $this->uploadDocument($oldContent, $oldPlain);
        $thread = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Anchored text.');
        $this->seedApproval($document, $current, $author);

        $this->fakeProjectionAndReanchor($newPlain, [[
            'threadId' => $thread->id,
            'state' => 'relocated',
            'exact' => $oldPlain,
            'prefix' => '',
            'suffix' => ' edited.',
            'start' => 0,
            'end' => strlen($oldPlain),
        ]]);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => "# Doc\n\nAnchored text edited.\n"])
            ->assertStatus(202);

        $rows = AuditLog::query()->where('action', 'approval.gone_stale')->get();
        $this->assertCount(1, $rows);
        $this->assertSame($current->id, $rows->first()->meta['from_version_id']);
        $this->assertSame(1, $rows->first()->meta['count']);
    }

    public function test_a_failed_update_never_disturbs_the_current_version(): void
    {
        // A 4xx from the re-anchor endpoint marks the sync failed WITHOUT retrying
        // (ReanchorRequestException → markFailed, no re-throw), so the synchronous
        // job completes and the endpoint still returns 202 — but the current
        // version is untouched (SPEC §5.3).
        $oldContent = "# Doc\n\nOld text.\n";
        [$author, $document, $current] = $this->uploadDocument($oldContent, 'Old text.');
        $this->threadWithAnchor($document, $author, $current, 'Old text.', 'Old text.');
        $this->fakeProjectionAndRejectedReanchor('New text.');

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/content", ['content' => "# Doc\n\nNew text.\n"])
            ->assertStatus(202);

        $document->refresh();
        $target = DocumentVersion::query()->where('content_hash', hash('sha256', "# Doc\n\nNew text.\n"))->first();
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertSame($current->id, $document->current_version_id);
        if ($target !== null) {
            $this->assertNotSame($target->id, $document->current_version_id);
            $this->assertDatabaseMissing('anchors', ['document_version_id' => $target->id]);
        }
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString("couldn't finish", (string) $document->sync_error);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.failed', 'subject_id' => $document->id]);
    }

    // --- helpers (mirrors DocumentResyncTest's seams for the upload trigger) ---

    /**
     * @param  array<string, string>|null  $sourceMeta
     * @return array{User, Document, DocumentVersion}
     */
    private function uploadDocument(
        string $content = "# Doc\n\nAlpha target text.\n",
        string $plainText = 'Alpha target text.',
        ?array $sourceMeta = null,
    ): array {
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create([
                'created_by' => $author->id,
                'source_type' => SourceType::Upload,
                'source_url' => null,
                'source_meta' => $sourceMeta ?? ['content' => $content],
            ]);
        $version = $this->attachVersion($document, $content, $plainText);

        return [$author, $document->refresh(), $version];
    }

    private function attachVersion(Document $document, string $content, string $plainText): DocumentVersion
    {
        $version = DocumentVersion::factory()
            ->for($document)
            ->create([
                'content_raw' => $content,
                'content_normalized' => $content,
                'content_hash' => hash('sha256', $content),
                'plain_text' => $plainText,
                'projection_version' => '2',
            ]);

        $document->forceFill(['current_version_id' => $version->id])->save();
        $document->setRelation('currentVersion', $version);

        return $version;
    }

    private function threadWithAnchor(
        Document $document,
        User $author,
        DocumentVersion $version,
        string $plainText,
        string $exact,
    ): Thread {
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $thread->comments()->create([
            'author_id' => $author->id,
            'body_md' => "Comment on {$exact}",
        ]);
        $thread->anchors()->create($this->anchorFor($plainText, $exact, (string) $version->projection_version) + [
            'document_version_id' => $version->id,
        ]);

        return $thread->load('anchors');
    }

    /**
     * @return array{exact: string, prefix: string, suffix: string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function anchorFor(string $plainText, string $exact, string $projectionVersion): array
    {
        $start = strpos($plainText, $exact);
        $this->assertNotFalse($start);
        $end = $start + strlen($exact);

        return [
            'exact' => $exact,
            'prefix' => substr($plainText, max(0, $start - 8), min(8, $start)),
            'suffix' => substr($plainText, $end, 8),
            'start' => $start,
            'end' => $end,
            'heading_path' => ['Doc'],
            'projection_version' => $projectionVersion,
        ];
    }

    /**
     * @return array{exact: string, prefix: ?string, suffix: ?string, start: int, end: int}
     */
    private function resultFromAnchor(Anchor $anchor): array
    {
        return [
            'exact' => (string) $anchor->exact,
            'prefix' => $anchor->prefix,
            'suffix' => $anchor->suffix,
            'start' => (int) $anchor->start,
            'end' => (int) $anchor->end,
        ];
    }

    private function seedApproval(Document $document, DocumentVersion $version, User $user): Approval
    {
        return Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $version->id,
            'user_id' => $user->id,
        ]);
    }

    private function fakeProjection(string $plainText, string $version = '2'): void
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

    /**
     * @param  list<array<string, mixed>>  $results
     */
    private function fakeProjectionAndReanchor(string $plainText, array $results, string $version = '2'): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => [],
            ]),
            '*/internal/reanchor' => Http::response(['results' => $results]),
        ]);
    }

    private function fakeProjectionAndRejectedReanchor(string $plainText, string $version = '2'): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => [],
            ]),
            '*/internal/reanchor' => Http::response(['error' => 'bad request'], 400),
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
