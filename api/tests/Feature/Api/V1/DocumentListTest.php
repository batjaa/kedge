<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use App\Models\Approval;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Models\Workspace;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The workspace document list (SPEC 11, decisions 1A/4A/6A) over the HTTP seam.
 * The home reads this endpoint page by page; the matrix here is the traced one
 * from the spec — scoping (IDOR), the `viewAny` 403 for a workspace-less
 * reviewer, the `per_page` clamp, `open_threads_count` correctness, the lean
 * (content-free) payload, and structural exclusion of the system workspace's
 * demo docs.
 */
class DocumentListTest extends TestCase
{
    use RefreshDatabase;

    public function test_lists_workspace_documents_newest_first_with_the_lean_payload_shape(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $older = Document::factory()->for($workspace)->ready()->create([
            'title' => 'Older doc',
            'created_at' => now()->subHour(),
        ]);
        $version = DocumentVersion::factory()->for($older)->create([
            'synced_at' => now()->subMinutes(30),
        ]);
        $older->update(['current_version_id' => $version->id]);

        $newer = Document::factory()->for($workspace)->create([
            'title' => 'Newer doc',
            'created_at' => now(),
        ]);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents');

        $response->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.0.title', 'Newer doc')
            ->assertJsonPath('data.1.id', $older->id);

        // The row is exactly the lean set — no more, no less. `project` (M3.6) is
        // the reserved chip slot: id + name, or null for Unfiled. M3.10 adds ONLY
        // `source` (the provenance descriptor) and `tracked_repo_id` (the project
        // page's bucketing key) — nothing else grows (#117 AC).
        $this->assertEqualsCanonicalizing(
            ['id', 'title', 'status', 'last_sync_status', 'sync_error', 'lifecycle_status', 'open_threads_count', 'synced_at', 'project', 'source', 'tracked_repo_id', 'created_at'],
            array_keys($response->json('data.0')),
        );

        // synced_at is projected from the current version's timestamp (present on
        // the ready doc, null on the still-importing one).
        $this->assertNotNull($response->json('data.1.synced_at'));
        $this->assertNull($response->json('data.0.synced_at'));
    }

    public function test_scopes_strictly_to_the_callers_workspace(): void
    {
        $userA = $this->registerUser('a@example.com');
        $userB = $this->registerUser('b@example.com');

        $docA = Document::factory()->for($userA->personalWorkspace())->create(['title' => 'A doc']);
        $docB = Document::factory()->for($userB->personalWorkspace())->create(['title' => 'B doc']);

        $response = $this->actingAs($userA)->fromWebApp()
            ->getJson('/api/v1/documents');

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $docA->id);

        // Another workspace's document is never disclosed, id and all.
        $this->assertNotContains($docB->id, array_column($response->json('data'), 'id'));
    }

    public function test_a_workspaceless_reviewer_is_refused_403_not_500(): void
    {
        // A magic-link reviewer holds no personal workspace; viewAny refuses
        // cleanly instead of dereferencing a null workspace.
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertForbidden();
    }

    public function test_an_unauthenticated_request_is_401(): void
    {
        $this->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertUnauthorized();
    }

    public function test_per_page_is_clamped_to_the_shared_bounds(): void
    {
        $user = $this->registerUser();
        Document::factory()->count(3)->for($user->personalWorkspace())->create();

        // Default page size.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 20);

        // Upper bound: a runaway request is capped at 50.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?per_page=100000')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 50);

        // Lower bound: 0 or negative floors at 1.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?per_page=0')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 1);
    }

    public function test_same_second_documents_paginate_without_dropping_or_duplicating_rows(): void
    {
        $user = $this->registerUser();

        // 25 documents sharing one second-precision timestamp: `latest()` alone
        // cannot order them, so only the `id` tiebreaker keeps a page boundary from
        // permuting rows between reads — which would drop one straddling row and
        // double another (4A).
        $ids = Document::factory()->count(25)->for($user->personalWorkspace())
            ->create(['created_at' => now()])
            ->pluck('id')
            ->all();

        $pageOne = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?per_page=20')
            ->assertOk();
        $pageTwo = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?per_page=20&page=2')
            ->assertOk();

        $seen = array_merge(
            array_column($pageOne->json('data'), 'id'),
            array_column($pageTwo->json('data'), 'id'),
        );

        // The union of the two pages is every id exactly once — no straddling row
        // lost, none duplicated.
        $this->assertCount(25, $seen);
        $this->assertSame(count($seen), count(array_unique($seen)));
        $this->assertEqualsCanonicalizing($ids, $seen);
    }

    public function test_open_threads_count_counts_only_open_threads(): void
    {
        $user = $this->registerUser();
        $doc = Document::factory()->for($user->personalWorkspace())->create();

        foreach (range(1, 2) as $i) {
            Thread::create([
                'document_id' => $doc->id,
                'type' => ThreadType::Inline->value,
                'status' => ThreadStatus::Open->value,
                'created_by' => $user->id,
            ]);
        }
        Thread::create([
            'document_id' => $doc->id,
            'type' => ThreadType::Inline->value,
            'status' => ThreadStatus::Resolved->value,
            'created_by' => $user->id,
        ]);

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertOk()
            ->assertJsonPath('data.0.open_threads_count', 2);
    }

    public function test_the_payload_never_carries_document_content(): void
    {
        $user = $this->registerUser();
        $doc = Document::factory()->for($user->personalWorkspace())->ready()->create();
        $version = DocumentVersion::factory()->for($doc)->create([
            'content_raw' => "# Secret content marker\n",
            'content_normalized' => "# Secret content marker\n",
            'plain_text' => 'Secret content marker',
        ]);
        $doc->update(['current_version_id' => $version->id]);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents');

        $response->assertOk();

        // The lean row omits the version relation entirely — no content in any form.
        $this->assertArrayNotHasKey('current_version', $response->json('data.0'));
        $this->assertStringNotContainsString('Secret content marker', $response->getContent());
        $this->assertStringNotContainsString('content_raw', $response->getContent());
        $this->assertStringNotContainsString('content_normalized', $response->getContent());
    }

    public function test_system_workspace_demo_documents_are_excluded(): void
    {
        $user = $this->registerUser();
        $mine = Document::factory()->for($user->personalWorkspace())->create(['title' => 'Mine']);
        $demo = Document::factory()->demo()->create(['title' => 'Demo doc']);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents');

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);

        // The demo doc lives in the system workspace, outside the scope by construction.
        $this->assertNotContains($demo->id, array_column($response->json('data'), 'id'));
    }

    // ---- M3.7: the server-side lifecycle filter (#103, decision 7A) ----------

    public function test_lifecycle_filter_narrows_the_list_to_the_requested_state(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $draft = Document::factory()->for($workspace)->create(['lifecycle_status' => LifecycleStatus::Draft]);
        $inReview = Document::factory()->for($workspace)->create(['lifecycle_status' => LifecycleStatus::InReview]);
        Document::factory()->for($workspace)->create(['lifecycle_status' => LifecycleStatus::Approved]);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=in_review')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $inReview->id)
            // The paginator counts the FILTERED query, not the loaded page.
            ->assertJsonPath('meta.total', 1);

        // The draft and approved docs are not in the in-review page.
        $this->assertNotContains($draft->id, array_column($response->json('data'), 'id'));
    }

    public function test_all_and_an_absent_lifecycle_are_the_same_identity_page(): void
    {
        $user = $this->registerUser();
        Document::factory()->count(3)->for($user->personalWorkspace())->create([
            'lifecycle_status' => LifecycleStatus::Draft,
        ]);
        Document::factory()->for($user->personalWorkspace())->create([
            'lifecycle_status' => LifecycleStatus::Approved,
        ]);

        // `?lifecycle=all` is the identity — the same total as no filter at all.
        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=all')
            ->assertOk()
            ->assertJsonPath('meta.total', 4);
    }

    public function test_needs_attention_filter_returns_the_failed_orphan_and_stale_composite(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // A failed first import.
        $failed = Document::factory()->for($workspace)->failed()->create();

        // A ready doc carrying an orphaned thread on its current version.
        $orphaned = $this->readyDoc($workspace);
        $this->orphanThreadOn($orphaned, $user);

        // A ready doc with an active approval pinned to a superseded version.
        $stale = $this->readyDoc($workspace);
        $oldVersion = DocumentVersion::factory()->for($stale)->create();
        Approval::factory()->for($stale)->create(['document_version_id' => $oldVersion->id]);

        // Healthy docs that must NOT surface under Needs attention.
        $this->readyDoc($workspace);
        $this->readyDoc($workspace);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=needs_attention')
            ->assertOk()
            ->assertJsonPath('meta.total', 3);

        $ids = array_column($response->json('data'), 'id');
        $this->assertEqualsCanonicalizing([$failed->id, $orphaned->id, $stale->id], $ids);
    }

    public function test_lifecycle_filter_is_correct_across_pagination_not_just_the_loaded_page(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // 25 approved docs spanning two 20-row pages, plus decoys in other states
        // that must never leak into the filtered set.
        $approvedIds = Document::factory()->count(25)->for($workspace)
            ->create(['lifecycle_status' => LifecycleStatus::Approved])
            ->pluck('id')
            ->all();
        Document::factory()->count(7)->for($workspace)->create(['lifecycle_status' => LifecycleStatus::Draft]);

        $pageOne = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=approved&per_page=20')
            ->assertOk()
            // The total is the whole filtered set (7A), not the 20 loaded rows.
            ->assertJsonPath('meta.total', 25)
            ->assertJsonCount(20, 'data');
        $pageTwo = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=approved&per_page=20&page=2')
            ->assertOk()
            ->assertJsonCount(5, 'data');

        $seen = array_merge(
            array_column($pageOne->json('data'), 'id'),
            array_column($pageTwo->json('data'), 'id'),
        );

        // Every approved id exactly once across the two pages, and nothing else.
        $this->assertCount(25, $seen);
        $this->assertEqualsCanonicalizing($approvedIds, $seen);
    }

    public function test_an_unknown_lifecycle_value_is_rejected_not_silently_ignored(): void
    {
        $user = $this->registerUser();
        Document::factory()->for($user->personalWorkspace())->create();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?lifecycle=bogus')
            ->assertStatus(422)
            ->assertJsonValidationErrorFor('lifecycle');
    }

    // ---- M3.10: the provenance descriptor on the row (#117, SPEC §11) --------

    public function test_each_row_carries_the_server_derived_source_descriptor_per_kind(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $repo = TrackedRepo::factory()->for($workspace)->create();
        $tracked = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/rfcs/017-anchoring.md',
            'tracked_repo_id' => $repo->id,
            'tracked_path' => 'docs/rfcs/017-anchoring.md',
        ]);
        $github = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/spec.md',
            'tracked_path' => null,
        ]);
        $rawUrl = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::RawUrl,
            'source_url' => 'https://raw.example.test/specs/plan.md',
            'tracked_path' => null,
        ]);
        $upload = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::Upload,
            'source_url' => null,
            'tracked_path' => null,
        ]);
        $unparseableGithub = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/tree/main/docs',
            'tracked_path' => null,
        ]);

        $rows = $this->rowsById($user);

        // Tracked → repo path (and the bucketing id rides along).
        $this->assertSame(['kind' => 'repo', 'path' => 'docs/rfcs/017-anchoring.md'], $rows[$tracked->id]['source']);
        $this->assertSame($repo->id, $rows[$tracked->id]['tracked_repo_id']);

        // Standalone GitHub → owner/repo + blob path.
        $this->assertSame(
            ['kind' => 'github', 'path' => 'docs/spec.md', 'repo' => 'kedgehq/kedge'],
            $rows[$github->id]['source'],
        );
        $this->assertNull($rows[$github->id]['tracked_repo_id']);

        // Raw URL → host only, no path.
        $this->assertSame(['kind' => 'url', 'host' => 'raw.example.test'], $rows[$rawUrl->id]['source']);

        // Upload → pasted.
        $this->assertSame(['kind' => 'upload'], $rows[$upload->id]['source']);

        // An unparseable GitHub URL degrades to the host shape — never an error,
        // never a null descriptor (untrusted input, SPEC §13).
        $this->assertSame(['kind' => 'url', 'host' => 'github.com'], $rows[$unparseableGithub->id]['source']);
    }

    public function test_a_tracked_document_keeps_its_repo_path_chip_after_the_repo_is_deleted(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $repo = TrackedRepo::factory()->for($workspace)->create();
        $doc = Document::factory()->for($workspace)->create([
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/blob/main/docs/adr/0001.md',
            'tracked_repo_id' => $repo->id,
            'tracked_path' => 'docs/adr/0001.md',
        ]);

        // Un-tracking / deleting the repo nulls tracked_repo_id (nullOnDelete) but
        // keeps the document and its path column (story 5).
        $repo->delete();

        $rows = $this->rowsById($user);

        $this->assertNull($rows[$doc->id]['tracked_repo_id']);
        // Provenance survives: the path column still names the origin.
        $this->assertSame(['kind' => 'repo', 'path' => 'docs/adr/0001.md'], $rows[$doc->id]['source']);
    }

    /**
     * The list rows keyed by document id — order-independent lookup for the
     * per-kind provenance assertions above.
     *
     * @return array<int, array<string, mixed>>
     */
    private function rowsById(User $user): array
    {
        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertOk();

        $rows = [];
        foreach ($response->json('data') as $row) {
            $rows[$row['id']] = $row;
        }

        return $rows;
    }

    // ---- helpers ------------------------------------------------------------

    private function readyDoc(Workspace $workspace): Document
    {
        $document = Document::factory()->for($workspace)->ready()->create();
        $version = DocumentVersion::factory()->for($document)->create();
        $document->update(['current_version_id' => $version->id]);

        return $document->refresh();
    }

    private function orphanThreadOn(Document $document, User $user): void
    {
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => ThreadType::Inline->value,
            'status' => ThreadStatus::Open->value,
            'created_by' => $user->id,
        ]);
        $thread->anchors()->create([
            'document_version_id' => $document->current_version_id,
            'exact' => 'anchored text',
            'start' => 0,
            'end' => 12,
            'projection_version' => '1',
            'state' => AnchorState::Orphaned->value,
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
