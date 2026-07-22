<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TrackedScanStatus;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\RegistrationService;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Un-tracking a repo (SPEC §16, M3.6, decision 7A; stories 16/19). Deleting the
 * record leaves every document it imported — provenance cleared, review history
 * intact — and is refused with a 409 while a scan is running so a delete can't
 * race a mid-import scan. Policy-gated and audit-logged; a foreign id is denied
 * 403, never an access path.
 */
class TrackedRepoDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_deleting_a_tracked_repo_leaves_its_documents_with_provenance_nulled(): void
    {
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Ok,
        ]);
        $a = $this->heldDoc($user, $repo, 'docs/a.md');
        $b = $this->heldDoc($user, $repo, 'docs/b.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        // The record is gone…
        $this->assertDatabaseMissing('tracked_repos', ['id' => $repo->id]);

        // …but both documents remain, with the full provenance quartet cleared.
        foreach ([$a, $b] as $document) {
            $document->refresh();
            $this->assertNull($document->tracked_repo_id);
            $this->assertNull($document->tracked_path);
            $this->assertNull($document->tracked_blob_sha);
            // Untouched otherwise — still in the workspace, still filed where it was.
            $this->assertSame($user->personalWorkspace()->id, $document->workspace_id);
        }
    }

    public function test_delete_is_audit_logged_with_the_orphaned_count(): void
    {
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create();
        $this->heldDoc($user, $repo, 'docs/a.md');
        $this->heldDoc($user, $repo, 'docs/b.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        $entry = AuditLog::query()->where('action', 'tracked_repo.deleted')->latest('id')->firstOrFail();
        $this->assertSame($user->id, $entry->user_id);
        $this->assertSame($repo->id, $entry->subject_id);
        $this->assertSame(2, $entry->meta['documents_orphaned']);
    }

    public function test_two_docs_from_the_same_repo_survive_delete_without_a_unique_collision(): void
    {
        // The composite unique index is on (tracked_repo_id, tracked_path). Nulling
        // both on every doc turns them all into (null, null); SQL treats NULLs as
        // distinct, so many orphaned docs coexist — the delete must not trip it.
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create();
        $this->heldDoc($user, $repo, 'docs/a.md');
        $this->heldDoc($user, $repo, 'docs/b.md');
        $this->heldDoc($user, $repo, 'docs/c.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        $this->assertSame(3, Document::query()->whereNull('tracked_repo_id')->whereNull('tracked_path')->count());
    }

    public function test_delete_is_a_409_while_a_scan_is_running(): void
    {
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Running,
            'last_scanned_at' => CarbonImmutable::now(), // a fresh, live claim
        ]);
        $doc = $this->heldDoc($user, $repo, 'docs/a.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertStatus(409);

        // Nothing was touched — the record and its provenance survive the refusal.
        $this->assertDatabaseHas('tracked_repos', ['id' => $repo->id]);
        $this->assertSame($repo->id, $doc->fresh()->tracked_repo_id);
    }

    public function test_a_stale_running_claim_no_longer_blocks_delete(): void
    {
        // The 15-minute stale bound keeps the wait finite: a crashed worker's
        // `running` never wedges the record un-deletable.
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Running,
            'last_scanned_at' => CarbonImmutable::now()->subMinutes(TrackedRepoScanService::STALE_MINUTES + 5),
        ]);

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('tracked_repos', ['id' => $repo->id]);
    }

    public function test_a_foreign_tracked_repo_cannot_be_deleted(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $repo = TrackedRepo::factory()->for($owner->personalWorkspace())->create();
        $doc = $this->heldDoc($owner, $repo, 'docs/a.md');

        $this->actingAs($stranger)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertForbidden();

        // The owner's record and its provenance are untouched by the denied request.
        $this->assertDatabaseHas('tracked_repos', ['id' => $repo->id]);
        $this->assertSame($repo->id, $doc->fresh()->tracked_repo_id);
    }

    public function test_a_workspaceless_reviewer_is_refused_403(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $repo = TrackedRepo::factory()->for($owner->personalWorkspace())->create();

        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertForbidden();
    }

    public function test_delete_requires_authentication(): void
    {
        $repo = TrackedRepo::factory()->create();

        $this->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertUnauthorized();
    }

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    private function heldDoc(User $user, TrackedRepo $repo, string $path): Document
    {
        return Document::factory()->for($user->personalWorkspace())->create([
            'project_id' => $repo->project_id,
            'tracked_repo_id' => $repo->id,
            'tracked_path' => $path,
            'tracked_blob_sha' => sha1($path),
        ]);
    }
}
