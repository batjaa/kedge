<?php

namespace Tests\Feature\Api\V1;

use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
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
        // the reserved chip slot: id + name, or null for Unfiled.
        $this->assertEqualsCanonicalizing(
            ['id', 'title', 'status', 'last_sync_status', 'sync_error', 'lifecycle_status', 'open_threads_count', 'synced_at', 'project', 'created_at'],
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

    // ---- helpers ------------------------------------------------------------

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
