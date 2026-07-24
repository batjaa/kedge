<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Jobs\ResyncDocumentJob;
use App\Models\Anchor;
use App\Models\Approval;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Exceptions\ProjectionFailedException;
use App\Services\Import\Exceptions\TokenRevokedException;
use App\Services\Reanchor\Exceptions\ReanchorUnavailableException;
use App\Services\RegistrationService;
use App\Services\Resync\ResyncService;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class DocumentResyncTest extends TestCase
{
    use RefreshDatabase;

    private const RAW_URL = 'https://raw.githubusercontent.com/kedgehq/kedge/main/SPEC.md';

    public function test_resync_endpoint_dispatches_the_unique_job(): void
    {
        Queue::fake();
        [$author, $document] = $this->readyDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/resync")
            ->assertStatus(202)
            ->assertJsonPath('status', 'ready');

        Queue::assertPushed(
            ResyncDocumentJob::class,
            fn (ResyncDocumentJob $job) => $job->document->is($document) && $job->actorId === $author->id,
        );
    }

    public function test_resync_endpoint_404s_when_disabled(): void
    {
        Queue::fake();
        config(['kedge.resync.enabled' => false]);
        [$author, $document] = $this->readyDocument();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/resync")
            ->assertNotFound();

        Queue::assertNotPushed(ResyncDocumentJob::class);
    }

    public function test_resync_job_is_unique_per_document(): void
    {
        $document = Document::factory()->create();
        $job = new ResyncDocumentJob($document);

        $this->assertInstanceOf(ShouldBeUnique::class, $job);
        $this->assertSame((string) $document->id, $job->uniqueId());
    }

    public function test_same_hash_as_current_is_a_noop(): void
    {
        $content = "# Stable\n\nSame content.\n";
        [$author, $document, $current] = $this->readyDocument($content, "Stable\n\nSame content.");
        $this->fakeFetchReturns($content);
        $this->fakeProjection("Stable\n\nSame content.");

        $this->runResync($document, $author);

        $document->refresh();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertNull($document->sync_error);
        $this->assertDatabaseCount('document_versions', 1);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.started', 'subject_id' => $document->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.completed', 'subject_id' => $document->id]);
        Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/internal/reanchor'));
    }

    public function test_changed_content_reanchors_then_advances_the_current_pointer(): void
    {
        $oldContent = "# Doc\n\nAlpha survives.\n\nBeta deleted.\n\nMoved phrase.\n";
        $oldPlain = "Alpha survives.\n\nBeta deleted.\n\nMoved phrase.";
        $newContent = "# Doc\n\nAlpha survives.\n\nGamma new.\n\nMoved phrase.\n";
        $newPlain = "Alpha survives.\n\nGamma new.\n\nMoved phrase.";
        [$author, $document, $current] = $this->readyDocument($oldContent, $oldPlain);
        $survives = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Alpha survives.');
        $deleted = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Beta deleted.');
        $moved = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Moved phrase.');
        Log::spy();

        $this->fakeFetchReturns($newContent);
        $this->fakeProjectionAndReanchor($newPlain, [
            [
                'threadId' => $survives->id,
                'state' => 'anchored',
                'exact' => 'Alpha survives.',
                'prefix' => '',
                'suffix' => "\n\nGamma new.\n\nMoved phrase.",
                'start' => 0,
                'end' => 15,
            ],
            [
                'threadId' => $deleted->id,
                'state' => 'orphaned',
                ...$this->resultFromAnchor($deleted->anchors()->where('document_version_id', $current->id)->firstOrFail()),
            ],
            [
                'threadId' => $moved->id,
                'state' => 'relocated',
                'exact' => 'Moved phrase.',
                'prefix' => "Alpha survives.\n\nGamma new.\n\n",
                'suffix' => '',
                'start' => 29,
                'end' => 42,
            ],
        ]);

        $this->runResync($document, $author);

        $document->refresh();
        $target = $document->currentVersion;
        $this->assertNotNull($target);
        $this->assertNotSame($current->id, $target->id);
        $this->assertSame($target->id, $document->current_version_id);
        $this->assertSame($current->id, $target->parent_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.started', 'subject_id' => $document->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'reanchor.completed', 'subject_id' => $document->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.completed', 'subject_id' => $document->id]);

        $this->assertDatabaseHas('anchors', [
            'thread_id' => $survives->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Anchored->value,
            'start' => 0,
            'end' => 15,
        ]);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $deleted->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Orphaned->value,
            'exact' => 'Beta deleted.',
        ]);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $moved->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Relocated->value,
            'exact' => 'Moved phrase.',
            'start' => 29,
            'end' => 42,
        ]);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.anchor.state', 'anchored')
            ->assertJsonPath('data.1.anchor.state', 'orphaned')
            ->assertJsonPath('data.2.anchor.state', 'relocated');

        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/reanchor')
            && $request['newPlainText'] === $newPlain
            && count($request['anchors']) === 3);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'resync.started'
            && $context['document_id'] === $document->id);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'reanchor.completed'
            && $context['document_id'] === $document->id
            && $context['anchored'] === 1
            && $context['relocated'] === 1
            && $context['orphaned'] === 1);
        Log::shouldHaveReceived('info')->withArgs(fn (string $event, array $context) => $event === 'resync.completed'
            && $context['document_id'] === $document->id
            && $context['deduped'] === false);
    }

    public function test_a_resync_writes_one_reanchor_digest_with_counts_thread_ids_and_title_snapshot(): void
    {
        $oldContent = "# Doc\n\nAlpha survives.\n\nBeta deleted.\n\nMoved phrase.\n";
        $oldPlain = "Alpha survives.\n\nBeta deleted.\n\nMoved phrase.";
        $newContent = "# Doc\n\nAlpha survives.\n\nGamma new.\n\nMoved phrase.\n";
        $newPlain = "Alpha survives.\n\nGamma new.\n\nMoved phrase.";
        [$author, $document, $current] = $this->readyDocument($oldContent, $oldPlain);
        $survives = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Alpha survives.');
        $deleted = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Beta deleted.');
        $moved = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Moved phrase.');

        $this->fakeFetchReturns($newContent);
        $this->fakeProjectionAndReanchor($newPlain, [
            [
                'threadId' => $survives->id,
                'state' => 'anchored',
                'exact' => 'Alpha survives.',
                'prefix' => '',
                'suffix' => "\n\nGamma new.\n\nMoved phrase.",
                'start' => 0,
                'end' => 15,
            ],
            [
                'threadId' => $deleted->id,
                'state' => 'orphaned',
                ...$this->resultFromAnchor($deleted->anchors()->where('document_version_id', $current->id)->firstOrFail()),
            ],
            [
                'threadId' => $moved->id,
                'state' => 'relocated',
                'exact' => 'Moved phrase.',
                'prefix' => "Alpha survives.\n\nGamma new.\n\n",
                'suffix' => '',
                'start' => 29,
                'end' => 42,
            ],
        ]);

        $this->runResync($document, $author);

        // Exactly one digest row for the whole re-sync — never a row per thread
        // (1A): a busy re-sync must read as a single feed line.
        $rows = AuditLog::query()->where('action', 'reanchor.completed')->get();
        $this->assertCount(1, $rows);

        $document->refresh();
        $digest = $rows->first();
        $this->assertSame($document->id, $digest->subject_id);
        // 2A display snapshot, frozen at write (the post-flip title the feed shows).
        $this->assertSame($document->title, $digest->meta['document_title']);
        $this->assertSame($current->id, $digest->meta['from_version_id']);
        $this->assertSame($document->current_version_id, $digest->meta['to_version_id']);
        // Counts drive #111's one-line sentence ("1 anchored, 1 relocated, 1 orphaned").
        $this->assertSame(1, $digest->meta['anchored']);
        $this->assertSame(1, $digest->meta['relocated']);
        $this->assertSame(1, $digest->meta['orphaned']);
        // Thread ids grouped by outcome so M5 re-derives per-thread relevance from
        // this one row instead of per-thread audit rows.
        $this->assertSame([$survives->id], $digest->meta['threads']['anchored']);
        $this->assertSame([$moved->id], $digest->meta['threads']['relocated']);
        $this->assertSame([$deleted->id], $digest->meta['threads']['orphaned']);
    }

    public function test_a_deduped_resync_writes_no_reanchor_digest(): void
    {
        // A no-op re-sync produces no anchor movements, so it emits no digest —
        // the feed line would otherwise read "0 anchored, 0 relocated, 0 orphaned".
        $content = "# Stable\n\nSame content.\n";
        [$author, $document] = $this->readyDocument($content, "Stable\n\nSame content.");
        $this->fakeFetchReturns($content);
        $this->fakeProjection("Stable\n\nSame content.");

        $this->runResync($document, $author);

        $this->assertSame(0, AuditLog::query()->where('action', 'reanchor.completed')->count());
    }

    public function test_fetch_failure_keeps_current_version_and_reconnect_copy(): void
    {
        [$author, $document, $current] = $this->readyDocument();
        $this->fakeFetchThrows(new TokenRevokedException('GitHub rejected the token.', 'Bad credentials'));

        $this->runResync($document, $author);

        $document->refresh();
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString('reconnect the integration', (string) $document->sync_error);
        $this->assertDatabaseCount('document_versions', 1);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.failed', 'subject_id' => $document->id]);
    }

    public function test_content_revert_reanchors_outgoing_threads_onto_the_resurrected_version(): void
    {
        $v1Content = "# Doc\n\nOriginal text.\n";
        $v1Plain = 'Original text.';
        $v2Content = "# Doc\n\nOriginal text.\n\nOnly in v2.\n";
        $v2Plain = "Original text.\n\nOnly in v2.";
        [$author, $document, $v1] = $this->readyDocument($v1Content, $v1Plain);
        $v2 = $this->attachVersion($document, $v2Content, $v2Plain, parentVersionId: $v1->id);
        $document->forceFill(['current_version_id' => $v2->id])->save();

        $originalThread = $this->threadWithAnchor($document, $author, $v1, $v1Plain, 'Original text.');
        $this->attachAnchor($originalThread, $v2, $v2Plain, 'Original text.');
        $v2OnlyThread = $this->threadWithAnchor($document, $author, $v2, $v2Plain, 'Only in v2.');

        $this->fakeFetchReturns($v1Content);
        $this->fakeProjectionAndReanchor($v1Plain, [
            [
                'threadId' => $originalThread->id,
                'state' => 'anchored',
                'exact' => 'Original text.',
                'prefix' => '',
                'suffix' => '',
                'start' => 0,
                'end' => 14,
            ],
            [
                'threadId' => $v2OnlyThread->id,
                'state' => 'orphaned',
                ...$this->resultFromAnchor($v2OnlyThread->anchors()->where('document_version_id', $v2->id)->firstOrFail()),
            ],
        ]);

        $this->runResync($document, $author);

        $document->refresh();
        $this->assertSame($v1->id, $document->current_version_id);
        $this->assertDatabaseCount('document_versions', 2);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $v2OnlyThread->id,
            'document_version_id' => $v1->id,
            'state' => AnchorState::Orphaned->value,
            'exact' => 'Only in v2.',
        ]);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads?per_page=10")
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_reanchor_failure_leaves_target_created_but_not_current_until_retries_exhaust(): void
    {
        $oldContent = "# Doc\n\nOld text.\n";
        $newContent = "# Doc\n\nNew text.\n";
        [$author, $document, $current] = $this->readyDocument($oldContent, 'Old text.');
        $this->threadWithAnchor($document, $author, $current, 'Old text.', 'Old text.');
        $this->fakeFetchReturns($newContent);
        $this->fakeProjectionAndUnavailableReanchor('New text.');

        try {
            $this->runResync($document, $author);
            $this->fail('Expected reanchor failure to bubble for a retry.');
        } catch (ReanchorUnavailableException) {
            // expected
        }

        $document->refresh();
        $target = DocumentVersion::query()->where('content_hash', hash('sha256', $newContent))->firstOrFail();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertNotSame($target->id, $document->current_version_id);
        $this->assertDatabaseMissing('anchors', ['document_version_id' => $target->id]);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);

        (new ResyncDocumentJob($document, $author->id))->failed(new ReanchorUnavailableException('endpoint down'));

        $document->refresh();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString("Re-sync couldn't finish", (string) $document->sync_error);
    }

    public function test_reanchor_4xx_marks_failed_without_retrying(): void
    {
        $oldContent = "# Doc\n\nOld text.\n";
        $newContent = "# Doc\n\nNew text.\n";
        [$author, $document, $current] = $this->readyDocument($oldContent, 'Old text.');
        $this->threadWithAnchor($document, $author, $current, 'Old text.', 'Old text.');
        $this->fakeFetchReturns($newContent);
        $this->fakeProjectionAndRejectedReanchor('New text.');

        $this->runResync($document, $author);

        $document->refresh();
        $target = DocumentVersion::query()->where('content_hash', hash('sha256', $newContent))->firstOrFail();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertNotSame($target->id, $document->current_version_id);
        $this->assertDatabaseMissing('anchors', ['document_version_id' => $target->id]);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString("Re-sync couldn't finish", (string) $document->sync_error);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resync.failed', 'subject_id' => $document->id]);
    }

    public function test_projection_failure_retries_without_landing_a_version(): void
    {
        $oldContent = "# Doc\n\nOld text.\n";
        $newContent = "# Doc\n\nNew text.\n";
        [$author, $document, $current] = $this->readyDocument($oldContent, 'Old text.');
        $this->fakeFetchReturns($newContent);
        Http::fake(['*/internal/projection' => Http::response(['error' => 'down'], 500)]);

        try {
            $this->runResync($document, $author);
            $this->fail('Expected projection failure to bubble for a retry.');
        } catch (ProjectionFailedException) {
            // expected
        }

        $document->refresh();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertDatabaseCount('document_versions', 1);

        (new ResyncDocumentJob($document, $author->id))->failed(new ProjectionFailedException('projection down'));

        $document->refresh();
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString('Sync failed', (string) $document->sync_error);
    }

    public function test_a_resync_flip_marks_prior_active_approvals_gone_stale_as_one_aggregate_row(): void
    {
        $oldContent = "# Doc\n\nAnchored text.\n";
        $oldPlain = 'Anchored text.';
        $newContent = "# Doc\n\nAnchored text edited.\n";
        $newPlain = 'Anchored text edited.';
        [$author, $document, $current] = $this->readyDocument($oldContent, $oldPlain);
        $thread = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Anchored text.');

        // Two reviewers' active approvals pinned to the outgoing version.
        $reviewer = User::factory()->create(['name' => 'Second Reviewer']);
        $this->seedApproval($document, $current, $author);
        $this->seedApproval($document, $current, $reviewer);

        $this->fakeChangedResync($thread, $oldPlain, $newContent, $newPlain);
        $this->runResync($document, $author);

        // Exactly one aggregate row — never one per approval (matches the
        // scan-report / re-anchor-digest precedent).
        $rows = AuditLog::query()->where('action', 'approval.gone_stale')->get();
        $this->assertCount(1, $rows);

        $entry = $rows->first();
        $this->assertSame($document->id, $entry->subject_id);
        $this->assertSame($document->fresh()->title, $entry->meta['document_title']);
        $this->assertSame($current->id, $entry->meta['from_version_id']);
        $this->assertSame(2, $entry->meta['count']);
        $this->assertEqualsCanonicalizing(
            ['Doc Author', 'Second Reviewer'],
            array_column($entry->meta['approvals'], 'approver_name'),
        );
    }

    public function test_a_resync_flip_writes_no_gone_stale_without_active_approvals(): void
    {
        $oldPlain = 'Anchored text.';
        [$author, $document, $current] = $this->readyDocument("# Doc\n\nAnchored text.\n", $oldPlain);
        $thread = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Anchored text.');

        $this->fakeChangedResync($thread, $oldPlain, "# Doc\n\nAnchored text edited.\n", 'Anchored text edited.');
        $this->runResync($document, $author);

        $this->assertSame(0, AuditLog::query()->where('action', 'approval.gone_stale')->count());
    }

    public function test_a_revoked_approval_is_not_reported_gone_stale(): void
    {
        $oldPlain = 'Anchored text.';
        [$author, $document, $current] = $this->readyDocument("# Doc\n\nAnchored text.\n", $oldPlain);
        $thread = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Anchored text.');
        $this->seedApproval($document, $current, $author)->forceFill(['revoked_at' => now()])->save();

        $this->fakeChangedResync($thread, $oldPlain, "# Doc\n\nAnchored text edited.\n", 'Anchored text edited.');
        $this->runResync($document, $author);

        $this->assertSame(0, AuditLog::query()->where('action', 'approval.gone_stale')->count());
    }

    public function test_a_deduped_resync_leaves_approvals_active_and_writes_no_gone_stale(): void
    {
        $content = "# Stable\n\nSame content.\n";
        [$author, $document, $current] = $this->readyDocument($content, "Stable\n\nSame content.");
        $approval = $this->seedApproval($document, $current, $author);
        $this->fakeFetchReturns($content);
        $this->fakeProjection("Stable\n\nSame content.");

        $this->runResync($document, $author);

        // No new version → the approval stays on the current version, never stale.
        $this->assertNull($approval->fresh()->revoked_at);
        $this->assertSame($current->id, $document->fresh()->current_version_id);
        $this->assertSame(0, AuditLog::query()->where('action', 'approval.gone_stale')->count());
    }

    public function test_a_dead_audit_sink_never_fails_the_resync(): void
    {
        $oldPlain = 'Anchored text.';
        [$author, $document, $current] = $this->readyDocument("# Doc\n\nAnchored text.\n", $oldPlain);
        $thread = $this->threadWithAnchor($document, $author, $current, $oldPlain, 'Anchored text.');
        $this->seedApproval($document, $current, $author);
        $this->fakeChangedResync($thread, $oldPlain, "# Doc\n\nAnchored text edited.\n", 'Anchored text edited.');

        // A fully dead audit sink: every record() throws. The whole resync path now
        // writes exclusively through the never-throwing recordSafely seam (#110
        // migrated resync.started/completed and the reanchor.completed digest off
        // record()), so each throw is swallowed and the re-sync is untouched.
        $logger = Mockery::mock(AuditLogger::class)->makePartial();
        $logger->shouldReceive('record')->andThrow(new RuntimeException('audit sink down'));
        $this->app->instance(AuditLogger::class, $logger);

        // No exception bubbles despite every audit write failing — the digest,
        // gone-stale, and lifecycle writes all fail silently.
        $this->runResync($document, $author);

        // The version flip committed and the sync landed clean: the dead audit sink
        // changed nothing about the domain outcome (AC — "audit failure never
        // affects the re-sync itself"), and no resync-path row was written.
        $document->refresh();
        $this->assertNotSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Ok, $document->last_sync_status);
        $this->assertNull($document->sync_error);
        $this->assertSame(0, AuditLog::query()->whereIn('action', [
            'resync.started',
            'reanchor.completed',
            'resync.completed',
            'approval.gone_stale',
        ])->count());
    }

    public function test_a_dead_audit_sink_never_disrupts_the_failure_path(): void
    {
        [$author, $document, $current] = $this->readyDocument();
        $this->fakeFetchThrows(new TokenRevokedException('GitHub rejected the token.', 'Bad credentials'));

        // markFailed() now writes resync.failed through the best-effort seam, from a
        // catch block and again from the exhausted failed() callback. A dead sink
        // must not throw back out of either or leave the failure half-applied.
        $logger = Mockery::mock(AuditLogger::class)->makePartial();
        $logger->shouldReceive('record')->andThrow(new RuntimeException('audit sink down'));
        $this->app->instance(AuditLogger::class, $logger);

        // Handled failure path (catch block → markFailed): no exception bubbles.
        $this->runResync($document, $author);

        $document->refresh();
        $this->assertSame(DocumentStatus::Ready, $document->status);
        $this->assertSame($current->id, $document->current_version_id);
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString('reconnect the integration', (string) $document->sync_error);

        // Exhausted-retries path (failed() callback → markFailed) stays clean too.
        (new ResyncDocumentJob($document, $author->id))->failed(new RuntimeException('exhausted'));

        $document->refresh();
        $this->assertSame(SyncStatus::Failed, $document->last_sync_status);
        $this->assertStringContainsString('Sync failed', (string) $document->sync_error);

        // No resync.failed row survived the dead sink — the write was swallowed.
        $this->assertSame(0, AuditLog::query()->where('action', 'resync.failed')->count());
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

    /**
     * A changed-content re-sync that relocates a single thread's anchor onto the
     * new version — enough to drive the version flip that stales approvals.
     */
    private function fakeChangedResync(Thread $thread, string $oldPlain, string $newContent, string $newPlain): void
    {
        $this->fakeFetchReturns($newContent);
        $this->fakeProjectionAndReanchor($newPlain, [[
            'threadId' => $thread->id,
            'state' => 'relocated',
            'exact' => $oldPlain,
            'prefix' => '',
            'suffix' => ' edited.',
            'start' => 0,
            'end' => $this->utf16CodeUnitLength($oldPlain),
        ]]);
    }

    /**
     * @return array{User, Document, DocumentVersion}
     */
    private function readyDocument(
        string $content = "# Doc\n\nAlpha target text.\n",
        string $plainText = 'Alpha target text.',
        string $projectionVersion = '2',
    ): array {
        $author = $this->registerUser();
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create([
                'created_by' => $author->id,
                'source_url' => self::RAW_URL,
            ]);
        $version = $this->attachVersion($document, $content, $plainText, $projectionVersion);

        return [$author, $document->refresh(), $version];
    }

    private function attachVersion(
        Document $document,
        string $content,
        string $plainText,
        string $projectionVersion = '2',
        ?int $parentVersionId = null,
    ): DocumentVersion {
        $version = DocumentVersion::factory()
            ->for($document)
            ->create([
                'parent_version_id' => $parentVersionId,
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
        $this->attachAnchor($thread, $version, $plainText, $exact);

        return $thread->load('anchors');
    }

    private function attachAnchor(Thread $thread, DocumentVersion $version, string $plainText, string $exact): Anchor
    {
        return $thread->anchors()->create($this->anchorFor($plainText, $exact, (string) $version->projection_version) + [
            'document_version_id' => $version->id,
        ]);
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

    private function fakeFetchReturns(string $body): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')
                ->andReturn(new FetchResult(200, $body, 'text/markdown', self::RAW_URL)),
        );
    }

    private function fakeFetchThrows(\Throwable $e): void
    {
        $this->mock(
            GuardedFetcher::class,
            fn ($mock) => $mock->shouldReceive('fetch')->andThrow($e),
        );
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

    private function fakeProjectionAndUnavailableReanchor(string $plainText, string $version = '2'): void
    {
        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $plainText,
                'projection_version' => $version,
                'mdx_ok' => true,
                'warnings' => [],
            ]),
            '*/internal/reanchor' => Http::response(['error' => 'down'], 500),
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

    private function runResync(Document $document, User $actor): void
    {
        (new ResyncDocumentJob($document, $actor->id))->handle(app(ResyncService::class));
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
