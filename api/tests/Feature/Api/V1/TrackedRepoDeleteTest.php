<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TrackedScanStatus;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\RegistrationService;
use App\Services\TrackedRepos\TrackedRepoDeleter;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpKernel\Exception\HttpException;
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

        // …but both documents remain: the repo link and the stale re-scan baseline
        // are cleared, while tracked_path is KEPT so the orphan stays visible to the
        // overlap warning (10A) and re-tracking can't silently duplicate it.
        foreach ([[$a, 'docs/a.md'], [$b, 'docs/b.md']] as [$document, $expectedPath]) {
            $document->refresh();
            $this->assertNull($document->tracked_repo_id);
            $this->assertNull($document->tracked_blob_sha);
            $this->assertSame($expectedPath, $document->tracked_path);
            // Untouched otherwise — still in the workspace, still filed where it was.
            $this->assertSame($user->personalWorkspace()->id, $document->workspace_id);
        }
    }

    public function test_delete_is_audit_logged_with_the_orphaned_count(): void
    {
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Ok,
        ]);
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
        // tracked_repo_id turns each orphan into (null, path); SQL treats a NULL
        // member as distinct, so many orphaned docs coexist — the delete must not
        // trip it even when two share a path.
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Ok,
        ]);
        $this->heldDoc($user, $repo, 'docs/a.md');
        $this->heldDoc($user, $repo, 'docs/b.md');
        $this->heldDoc($user, $repo, 'docs/c.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        // All three orphaned (repo link cleared) but each keeps its path.
        $this->assertSame(3, Document::query()->whereNull('tracked_repo_id')->whereNotNull('tracked_path')->count());
    }

    public function test_a_second_repo_deleting_the_same_path_does_not_collide(): void
    {
        // The strongest form of the NULL-distinctness guarantee: two deleted repos
        // that each held docs/spec.md leave two (null, 'docs/spec.md') orphans.
        $user = $this->registerUser();
        $repoA = TrackedRepo::factory()->for($user->personalWorkspace())->create(['last_scan_status' => TrackedScanStatus::Ok]);
        $repoB = TrackedRepo::factory()->for($user->personalWorkspace())->create(['last_scan_status' => TrackedScanStatus::Ok]);
        $this->heldDoc($user, $repoA, 'docs/spec.md');
        $this->heldDoc($user, $repoB, 'docs/spec.md');

        foreach ([$repoA, $repoB] as $repo) {
            $this->actingAs($user)->fromWebApp()
                ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
                ->assertNoContent();
        }

        $this->assertSame(
            2,
            Document::query()->whereNull('tracked_repo_id')->where('tracked_path', 'docs/spec.md')->count(),
        );
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

    public function test_delete_is_a_409_while_a_first_scan_is_queued_pending(): void
    {
        // A dispatched-not-yet-claimed scan sits at `pending` — a delete now would
        // race the mid-import scan just as `running` would, so it is refused (A4).
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Pending,
            'last_scanned_at' => null, // never scanned; staleness measures from created_at
        ]);
        $doc = $this->heldDoc($user, $repo, 'docs/a.md');

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertStatus(409);

        $this->assertDatabaseHas('tracked_repos', ['id' => $repo->id]);
        $this->assertSame($repo->id, $doc->fresh()->tracked_repo_id);
    }

    public function test_a_stale_pending_scan_no_longer_blocks_delete(): void
    {
        // The stale bound applies to a queued-too-long pending the same way it does
        // to a wedged running — a backed-up queue never makes a repo un-deletable.
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Pending,
            'last_scanned_at' => CarbonImmutable::now()->subMinutes(TrackedRepoScanService::STALE_MINUTES + 5),
        ]);

        $this->actingAs($user)->fromWebApp()
            ->deleteJson("/api/v1/tracked-repos/{$repo->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('tracked_repos', ['id' => $repo->id]);
    }

    public function test_the_deleter_aborts_atomically_when_a_scan_claims_between_the_precheck_and_the_delete(): void
    {
        // The controller's pre-check saw a settled record; the deleter re-verifies
        // in-flight status ATOMICALLY inside its transaction. If a scan claimed the
        // record meanwhile (→ running), the conditional delete matches 0 rows and
        // the transaction rolls back — provenance intact, record intact.
        $user = $this->registerUser();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Ok,
        ]);
        $doc = $this->heldDoc($user, $repo, 'docs/a.md');

        // Simulate the racing claim landing after the pre-check.
        TrackedRepo::query()->whereKey($repo->id)->update([
            'last_scan_status' => TrackedScanStatus::Running->value,
            'last_scanned_at' => CarbonImmutable::now(),
        ]);

        try {
            app(TrackedRepoDeleter::class)->delete($repo->fresh(), $user);
            $this->fail('Expected a 409 abort from the atomic re-verify.');
        } catch (HttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }

        // Nothing was destroyed: the provenance-nulling rolled back with the abort.
        $this->assertDatabaseHas('tracked_repos', ['id' => $repo->id]);
        $doc->refresh();
        $this->assertSame($repo->id, $doc->tracked_repo_id);
        $this->assertSame('docs/a.md', $doc->tracked_path);
        $this->assertNotNull($doc->tracked_blob_sha);
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
