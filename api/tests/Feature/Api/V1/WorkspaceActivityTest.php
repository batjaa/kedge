<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AuditEvent;
use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use App\Models\AuditLog;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Models\Workspace;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The dashboard's Recent activity feed (SPEC §16, M3.8 #111 — decisions
 * 3A/10A/A1, and 2A's render-from-snapshot rule) over the HTTP seam. Covers the
 * type allowlist, workspace scoping (IDOR), the Policy 403/401, pagination, the
 * one-line re-sync digest (1A), a deleted subject that keeps its sentence but
 * drops its link (2A), and — the credential-hygiene prior art — that `ip` and the
 * raw `meta` bag are NEVER serialized into any payload (3A).
 */
class WorkspaceActivityTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_projects_allowlisted_events_scoped_to_the_caller(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $document = $this->readyDoc($workspace);
        [$thread, $comment] = $this->threadWithComment($document, $user);

        AuditLog::factory()->for($workspace)->action(AuditEvent::DocumentImported)
            ->subject($document)
            ->withMeta(['document_title' => 'RFC 17 — Anchoring', 'actor_name' => 'Doc Author'])
            ->create(['created_at' => now()->subMinutes(10)]);

        AuditLog::factory()->for($workspace)->action(AuditEvent::CommentCreated)
            ->subject($comment)
            ->withMeta(['document_title' => 'RFC 17 — Anchoring', 'actor_name' => 'Sarah', 'section' => 'Re-anchoring'])
            ->create(['created_at' => now()->subMinutes(2)]);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk();

        // Newest first: the comment (2m ago) precedes the import (10m ago).
        $response
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.type', 'comment.created')
            ->assertJsonPath('data.0.actor.name', 'Sarah')
            ->assertJsonPath('data.0.context.document_title', 'RFC 17 — Anchoring')
            ->assertJsonPath('data.0.context.section', 'Re-anchoring')
            ->assertJsonPath('data.0.target.type', 'document')
            ->assertJsonPath('data.0.target.id', $document->id)
            ->assertJsonPath('data.1.type', 'document.imported')
            ->assertJsonPath('data.1.target.id', $document->id);

        // The exact row contract — no extra keys.
        $this->assertEqualsCanonicalizing(
            ['id', 'type', 'actor', 'context', 'target', 'created_at'],
            array_keys($response->json('data.0')),
        );
    }

    public function test_it_excludes_events_not_on_the_type_allowlist(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // On the allowlist.
        AuditLog::factory()->for($workspace)->action(AuditEvent::DocumentImported)
            ->withMeta(['document_title' => 'Kept'])->create();

        // NOT on the allowlist — instrumented, but no feed sentence.
        foreach ([
            AuditEvent::ThreadCreated,       // doubles comment.created; excluded
            AuditEvent::ProjectCreated,
            AuditEvent::ShareCreated,
            AuditEvent::IntegrationConnected,
            AuditEvent::ResyncStarted,
            AuditEvent::ThreadResolved,
        ] as $excluded) {
            AuditLog::factory()->for($workspace)->action($excluded)
                ->withMeta(['document_title' => 'Hidden'])->create();
        }

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'document.imported');

        // No excluded type ever appears in the payload.
        foreach (['thread.created', 'project.created', 'share.created', 'integration.connected', 'resync.started', 'thread.resolved'] as $hidden) {
            $this->assertStringNotContainsString($hidden, $response->getContent());
        }
    }

    public function test_it_scopes_strictly_to_the_callers_workspace(): void
    {
        $userA = $this->registerUser('a@example.com');
        $userB = $this->registerUser('b@example.com');

        AuditLog::factory()->for($userB->personalWorkspace())->action(AuditEvent::DocumentImported)
            ->withMeta(['document_title' => "B's private doc"])->create();
        AuditLog::factory()->for($userA->personalWorkspace())->action(AuditEvent::DocumentImported)
            ->withMeta(['document_title' => "A's own doc"])->create();

        $response = $this->actingAs($userA)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.context.document_title', "A's own doc");

        $this->assertStringNotContainsString("B's private doc", $response->getContent());
    }

    public function test_it_never_serializes_ip_or_raw_meta(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $document = $this->readyDoc($workspace);

        // A re-sync digest carries a rich meta bag (version ids, per-outcome thread
        // ids) alongside the counts the sentence needs, plus an `ip` on the column
        // and a planted secret. Only the projected fields may surface.
        AuditLog::factory()->for($workspace)->action(AuditEvent::ReanchorCompleted)
            ->subject($document)
            ->ip('203.0.113.7')
            ->withMeta([
                'document_title' => 'RFC 17',
                'from_version_id' => 41,
                'to_version_id' => 42,
                'anchored' => 28,
                'relocated' => 2,
                'orphaned' => 1,
                'threads' => ['anchored' => [1, 2, 3], 'relocated' => [4], 'orphaned' => [5]],
                'secret_internal' => 'DO-NOT-LEAK',
            ])
            ->create();

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk();

        // The projected sentence fields are present…
        $response
            ->assertJsonPath('data.0.context.anchored', 28)
            ->assertJsonPath('data.0.context.relocated', 2)
            ->assertJsonPath('data.0.context.orphaned', 1)
            ->assertJsonPath('data.0.context.document_title', 'RFC 17')
            ->assertJsonMissingPath('data.0.ip')
            ->assertJsonMissingPath('data.0.meta')
            ->assertJsonMissingPath('data.0.context.from_version_id')
            ->assertJsonMissingPath('data.0.context.threads');

        // …and NOTHING operational leaks anywhere in the payload string.
        $body = $response->getContent();
        $this->assertStringNotContainsString('203.0.113.7', $body);
        $this->assertStringNotContainsString('DO-NOT-LEAK', $body);
        $this->assertStringNotContainsString('from_version_id', $body);
        $this->assertStringNotContainsString('to_version_id', $body);
        $this->assertStringNotContainsString('threads', $body);

        // The context is exactly the four projected keys.
        $this->assertEqualsCanonicalizing(
            ['document_title', 'anchored', 'relocated', 'orphaned'],
            array_keys($response->json('data.0.context')),
        );
    }

    public function test_the_resync_digest_is_one_row_carrying_its_counts(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $document = $this->readyDoc($workspace);

        AuditLog::factory()->for($workspace)->action(AuditEvent::ReanchorCompleted)
            ->subject($document)
            ->withMeta(['document_title' => 'RFC 17', 'anchored' => 28, 'relocated' => 2, 'orphaned' => 1])
            ->create();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            // One row, never one per thread (1A).
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'reanchor.completed')
            ->assertJsonPath('data.0.context.anchored', 28)
            ->assertJsonPath('data.0.context.relocated', 2)
            ->assertJsonPath('data.0.context.orphaned', 1);
    }

    public function test_a_deleted_subject_keeps_its_sentence_but_drops_the_link(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $document = $this->readyDoc($workspace);
        [$thread, $comment] = $this->threadWithComment($document, $user);

        // A live comment resolves a target; a soft-deleted one does not, but the
        // sentence still renders from the frozen snapshot (2A).
        AuditLog::factory()->for($workspace)->action(AuditEvent::CommentCreated)
            ->subject($comment)
            ->withMeta(['document_title' => 'RFC 17', 'actor_name' => 'Sarah', 'section' => 'Intro'])
            ->create(['created_at' => now()->subMinute()]);

        $deletedComment = $thread->comments()->create(['author_id' => $user->id, 'body_md' => 'to be deleted']);
        AuditLog::factory()->for($workspace)->action(AuditEvent::CommentCreated)
            ->subject($deletedComment)
            ->withMeta(['document_title' => 'RFC 17', 'actor_name' => 'Sarah', 'section' => 'Intro'])
            ->create(['created_at' => now()]);
        $deletedComment->delete();

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        // Newest first: the deleted comment's row — sentence intact, link dropped.
        $response
            ->assertJsonPath('data.0.context.document_title', 'RFC 17')
            ->assertJsonPath('data.0.context.section', 'Intro')
            ->assertJsonPath('data.0.target', null);

        // The live comment's row still links to its document.
        $response
            ->assertJsonPath('data.1.target.type', 'document')
            ->assertJsonPath('data.1.target.id', $document->id);
    }

    public function test_a_deleted_document_drops_the_link_but_not_the_row(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $document = $this->readyDoc($workspace);

        AuditLog::factory()->for($workspace)->action(AuditEvent::DocumentImported)
            ->subject($document)
            ->withMeta(['document_title' => 'Gone but remembered', 'actor_name' => 'Doc Author'])
            ->create();

        $document->delete();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.context.document_title', 'Gone but remembered')
            ->assertJsonPath('data.0.target', null);
    }

    public function test_a_workspace_rename_targets_the_workspace(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        AuditLog::factory()->for($workspace)->action(AuditEvent::WorkspaceRenamed)
            ->subject($workspace)
            ->withMeta(['from' => ['name' => 'Old', 'slug' => 'old'], 'to' => ['name' => 'New Name', 'slug' => 'new']])
            ->create();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonPath('data.0.type', 'workspace.renamed')
            ->assertJsonPath('data.0.context.workspace_name', 'New Name')
            ->assertJsonPath('data.0.target.type', 'workspace')
            // No slug, no `from` — only the projected new name.
            ->assertJsonMissingPath('data.0.context.workspace_slug');
    }

    public function test_it_paginates_newest_first(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // 20 rows, oldest to newest, so ordering is unambiguous.
        for ($i = 0; $i < 20; $i++) {
            AuditLog::factory()->for($workspace)->action(AuditEvent::DocumentImported)
                ->withMeta(['document_title' => "doc-{$i}"])
                ->create(['created_at' => now()->subMinutes(20 - $i)]);
        }

        $page1 = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(15, 'data')
            ->assertJsonPath('meta.total', 20)
            ->assertJsonPath('meta.per_page', 15)
            // Newest (doc-19) first.
            ->assertJsonPath('data.0.context.document_title', 'doc-19');

        $page2 = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity?page=2')
            ->assertOk()
            ->assertJsonCount(5, 'data');

        // Pages don't overlap: page 2 begins where page 1 ended.
        $this->assertSame('doc-4', $page2->json('data.0.context.document_title'));
    }

    public function test_a_workspaceless_reviewer_is_refused_403_not_500(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertForbidden();
    }

    public function test_an_unauthenticated_request_is_401(): void
    {
        $this->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertUnauthorized();
    }

    public function test_an_empty_workspace_returns_an_empty_page(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/activity')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.total', 0);
    }

    // ---- fixtures -----------------------------------------------------------

    private function readyDoc(Workspace $workspace): Document
    {
        return Document::factory()->for($workspace)->ready()->create();
    }

    /**
     * @return array{Thread, Comment}
     */
    private function threadWithComment(Document $document, User $user): array
    {
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => ThreadType::Inline->value,
            'status' => ThreadStatus::Open->value,
            'created_by' => $user->id,
        ]);
        $comment = $thread->comments()->create(['author_id' => $user->id, 'body_md' => 'a comment']);

        return [$thread, $comment];
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
