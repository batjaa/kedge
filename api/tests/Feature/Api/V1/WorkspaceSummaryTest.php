<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\DocumentLifecycleFilter;
use App\Enums\LifecycleStatus;
use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use App\Models\Approval;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Models\Workspace;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The workspace dashboard summary (SPEC §16, M3.7 — decisions 7A/A1) over the
 * HTTP seam. The strip and the filter chips read this endpoint; the matrix here
 * is the traced one from the spec — every count (lifecycles / threads / orphans /
 * stale approvals / imports), workspace scoping (IDOR), the Policy 403 for a
 * workspace-less reviewer, the needs-attention composite, and the 7A invariant
 * that each chip count equals the total the same filter narrows the list to.
 */
class WorkspaceSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_reports_every_count_from_the_fixture_matrix(): void
    {
        $user = $this->registerUser();
        $this->seedMatrix($user->personalWorkspace(), $user);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk();

        // No `data` envelope — the single-resource house shape.
        $response
            ->assertJsonPath('documents.total', 6)
            ->assertJsonPath('documents.importing', 1)
            ->assertJsonPath('documents.needs_attention', 3)
            ->assertJsonPath('documents.lifecycle.draft', 3)
            ->assertJsonPath('documents.lifecycle.in_review', 1)
            ->assertJsonPath('documents.lifecycle.approved', 1)
            ->assertJsonPath('documents.lifecycle.superseded', 1)
            ->assertJsonPath('threads.open', 3)
            ->assertJsonPath('threads.orphaned', 1)
            ->assertJsonPath('approvals.stale', 1);

        // The exact contract shape — no extra keys leak.
        $this->assertEqualsCanonicalizing(
            ['documents', 'threads', 'approvals'],
            array_keys($response->json()),
        );
        $this->assertEqualsCanonicalizing(
            ['total', 'importing', 'needs_attention', 'lifecycle'],
            array_keys($response->json('documents')),
        );
    }

    public function test_an_empty_workspace_reports_zeroes_not_nulls(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('documents.total', 0)
            ->assertJsonPath('documents.importing', 0)
            ->assertJsonPath('documents.needs_attention', 0)
            ->assertJsonPath('documents.lifecycle.draft', 0)
            ->assertJsonPath('threads.open', 0)
            ->assertJsonPath('threads.orphaned', 0)
            ->assertJsonPath('approvals.stale', 0);
    }

    public function test_scopes_strictly_to_the_callers_workspace(): void
    {
        $userA = $this->registerUser('a@example.com');
        $userB = $this->registerUser('b@example.com');

        // B's workspace is full of everything; A's holds one draft.
        $this->seedMatrix($userB->personalWorkspace(), $userB);
        Document::factory()->for($userA->personalWorkspace())->ready()->create([
            'lifecycle_status' => LifecycleStatus::Draft,
        ]);

        $this->actingAs($userA)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('documents.total', 1)
            ->assertJsonPath('documents.needs_attention', 0)
            ->assertJsonPath('threads.open', 0)
            ->assertJsonPath('threads.orphaned', 0)
            ->assertJsonPath('approvals.stale', 0);
    }

    public function test_system_workspace_demo_documents_are_excluded(): void
    {
        $user = $this->registerUser();
        Document::factory()->for($user->personalWorkspace())->ready()->create();
        Document::factory()->demo()->create();

        // The demo doc lives in the system workspace, outside the scope by
        // construction — the summary counts one, not two.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('documents.total', 1);
    }

    public function test_a_workspaceless_reviewer_is_refused_403_not_500(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertForbidden();
    }

    public function test_an_unauthenticated_request_is_401(): void
    {
        $this->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertUnauthorized();
    }

    public function test_orphaned_counts_only_current_version_anchors(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // A doc on v2, with a thread whose OLD (v1) anchor is orphaned but whose
        // current (v2) anchor is anchored — not an orphan. Only the current-version
        // anchor decides, so this must not count.
        $document = Document::factory()->for($workspace)->ready()->create();
        $v1 = DocumentVersion::factory()->for($document)->create();
        $v2 = DocumentVersion::factory()->for($document)->create();
        $document->update(['current_version_id' => $v2->id]);

        $thread = $this->threadOn($document, $user);
        $this->anchor($thread, $v1, AnchorState::Orphaned);
        $this->anchor($thread, $v2, AnchorState::Anchored);

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('threads.orphaned', 0);
    }

    public function test_stale_ignores_revoked_and_current_version_approvals(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $document = Document::factory()->for($workspace)->ready()->create();
        $v1 = DocumentVersion::factory()->for($document)->create();
        $v2 = DocumentVersion::factory()->for($document)->create();
        $document->update(['current_version_id' => $v2->id]);

        // Pinned to the current version → not stale.
        Approval::factory()->for($document)->create(['document_version_id' => $v2->id]);
        // Pinned to an old version but revoked → not stale.
        Approval::factory()->for($document)->revoked()->create(['document_version_id' => $v1->id]);
        // Active and pinned to an old version → the one stale approval.
        Approval::factory()->for($document)->create(['document_version_id' => $v1->id]);

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('approvals.stale', 1);
    }

    public function test_needs_attention_counts_each_document_once_across_triggers(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // One document that is failed AND carries an orphaned thread AND a stale
        // approval — three triggers, still one document needing attention.
        $document = Document::factory()->for($workspace)->failed()->create();
        $v1 = DocumentVersion::factory()->for($document)->create();
        $v2 = DocumentVersion::factory()->for($document)->create();
        $document->update(['current_version_id' => $v2->id]);
        $this->anchor($this->threadOn($document, $user), $v2, AnchorState::Orphaned);
        Approval::factory()->for($document)->create(['document_version_id' => $v1->id]);

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk()
            ->assertJsonPath('documents.needs_attention', 1);
    }

    public function test_chip_count_equals_the_total_its_filter_narrows_the_list_to(): void
    {
        // The 7A invariant: the summary count for a state and the count the same
        // filter predicate narrows the documents list to are one number, computed
        // through one definition (DocumentLifecycleFilter). A future divergence
        // (the tracked-repo triple-encoding precedent) breaks this test.
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $this->seedMatrix($workspace, $user);

        $summary = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/workspace/summary')
            ->assertOk();

        $chipCounts = [
            DocumentLifecycleFilter::All->value => $summary->json('documents.total'),
            DocumentLifecycleFilter::Draft->value => $summary->json('documents.lifecycle.draft'),
            DocumentLifecycleFilter::InReview->value => $summary->json('documents.lifecycle.in_review'),
            DocumentLifecycleFilter::Approved->value => $summary->json('documents.lifecycle.approved'),
            DocumentLifecycleFilter::NeedsAttention->value => $summary->json('documents.needs_attention'),
        ];

        foreach ($chipCounts as $value => $chipCount) {
            // The list filter (M3.8, #103) applies the same predicate to a
            // workspace-scoped documents query — exactly this call.
            $filtered = DocumentLifecycleFilter::from($value)
                ->apply(Document::query()->where('workspace_id', $workspace->id))
                ->count();

            $this->assertSame(
                $filtered,
                $chipCount,
                "chip '{$value}' count ({$chipCount}) must equal the filtered list total ({$filtered})",
            );
        }
    }

    // ---- fixtures -----------------------------------------------------------

    /**
     * The traced matrix: 6 docs (draft/in_review/approved/superseded ready +
     * importing + failed), 3 open threads (one orphaned), 1 stale approval. Yields
     * needs_attention = 3 (failed doc, orphan-thread doc, stale-approval doc).
     */
    private function seedMatrix(Workspace $workspace, User $user): void
    {
        $draft = $this->readyDoc($workspace, LifecycleStatus::Draft);
        $inReview = $this->readyDoc($workspace, LifecycleStatus::InReview);
        $approved = $this->readyDoc($workspace, LifecycleStatus::Approved);
        $this->readyDoc($workspace, LifecycleStatus::Superseded);
        Document::factory()->for($workspace)->create(['lifecycle_status' => LifecycleStatus::Draft]); // importing
        Document::factory()->for($workspace)->failed()->create(['lifecycle_status' => LifecycleStatus::Draft]);

        // in_review doc: two open threads + one resolved (only open counts).
        $this->threadOn($inReview, $user);
        $this->threadOn($inReview, $user);
        $this->threadOn($inReview, $user, ThreadStatus::Resolved);

        // draft doc: one open thread orphaned on its current version.
        $orphan = $this->threadOn($draft, $user);
        $this->anchor($orphan, $draft->currentVersion, AnchorState::Orphaned);

        // approved doc: a stale active approval pinned to a superseded version.
        $oldVersion = DocumentVersion::factory()->for($approved)->create();
        Approval::factory()->for($approved)->create(['document_version_id' => $oldVersion->id]);
    }

    private function readyDoc(Workspace $workspace, LifecycleStatus $lifecycle): Document
    {
        $document = Document::factory()->for($workspace)->ready()->create([
            'lifecycle_status' => $lifecycle,
        ]);
        $version = DocumentVersion::factory()->for($document)->create();
        $document->update(['current_version_id' => $version->id]);

        return $document->refresh();
    }

    private function threadOn(Document $document, User $user, ThreadStatus $status = ThreadStatus::Open): Thread
    {
        return Thread::create([
            'document_id' => $document->id,
            'type' => ThreadType::Inline->value,
            'status' => $status->value,
            'created_by' => $user->id,
        ]);
    }

    private function anchor(Thread $thread, DocumentVersion $version, AnchorState $state): void
    {
        $thread->anchors()->create([
            'document_version_id' => $version->id,
            'exact' => 'anchored text',
            'start' => 0,
            'end' => 12,
            'projection_version' => '1',
            'state' => $state->value,
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
