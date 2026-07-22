<?php

namespace Tests\Feature\Api\V1;

use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\TrackedScanStatus;
use App\Jobs\ImportDocumentJob;
use App\Jobs\ScanTrackedRepoJob;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\Integration;
use App\Models\Project;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\RegistrationService;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The tracked-repo scan pipeline (SPEC §16, M3.6, #93; stories 9/12/13/15/20/22;
 * decisions 3A/4A/5A). Scan correctness is proven at this seam — the cheapest one
 * with full control of upstream state: the GitHub boundary is faked (recorded
 * repo/tree shapes replayed through the real SSRF-guarded fetcher) and only the
 * per-file {@see ImportDocumentJob} is faked, so the scan itself runs inline and
 * its dispatches are asserted, never executed.
 *
 * These tests assert external behavior — what the workspace holds and the record
 * reports after a scan — never the scan's internal ordering.
 */
class TrackedRepoScanTest extends TestCase
{
    use RefreshDatabase;

    private const REPO_URL = 'https://github.com/kedgehq/kedge';

    private const TOKEN = 'ghp_scanSECRETtoken2222222222222222222abcd';

    // ---- create + first scan (202) -----------------------------------------

    public function test_creating_a_tracked_repo_runs_its_first_scan_and_imports_matched_files(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/spec.md', 'docs/nested/design.mdx', 'README.md']));

        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create();

        $response = $this->actingAs($user)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
            'project_id' => $project->id,
        ]);

        $response->assertStatus(202)
            ->assertJsonPath('data.repo_url', self::REPO_URL)
            ->assertJsonPath('data.path_pattern', 'docs/**');

        $trackedRepo = TrackedRepo::query()->firstOrFail();

        // Every matched, importable file became an importing document in the project.
        $documents = Document::query()->where('tracked_repo_id', $trackedRepo->id)->get();
        $this->assertEqualsCanonicalizing(
            ['docs/nested/design.mdx', 'docs/spec.md'],
            $documents->pluck('tracked_path')->all(),
        );
        foreach ($documents as $document) {
            $this->assertSame(DocumentStatus::Importing, $document->status);
            $this->assertSame($project->id, $document->project_id);
        }

        // README.md was outside docs/ — never imported.
        $this->assertDatabaseMissing('documents', ['tracked_path' => 'README.md']);

        // The existing import pipeline was handed each new document.
        Queue::assertPushed(ImportDocumentJob::class, 2);
    }

    public function test_created_documents_carry_project_provenance_and_a_blob_source(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/spec.md']));

        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create();

        $this->actingAs($user)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
            'project_id' => $project->id,
        ])->assertStatus(202);

        $trackedRepo = TrackedRepo::query()->firstOrFail();
        $document = Document::query()->where('tracked_repo_id', $trackedRepo->id)->firstOrFail();

        $this->assertSame($project->id, $document->project_id);
        $this->assertSame($trackedRepo->id, $document->tracked_repo_id);
        $this->assertSame('docs/spec.md', $document->tracked_path);
        // The file's blob URL at the resolved branch — the existing import job reads
        // it exactly like a hand-imported blob URL.
        $this->assertSame('https://github.com/kedgehq/kedge/blob/main/docs/spec.md', $document->source_url);
        // A public repo (no PAT connected) imports through the public reader.
        $this->assertSame(SourceType::GithubPublic, $document->source_type);
        $this->assertSame($user->id, $document->created_by);
    }

    public function test_a_connected_pat_is_bound_to_the_created_documents(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser();
        $integration = Integration::factory()->withToken(self::TOKEN)->for($user->personalWorkspace())->create();

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/spec.md']));

        $this->actingAs($user)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
        ])->assertStatus(202);

        $document = Document::query()->whereNotNull('tracked_repo_id')->firstOrFail();
        $this->assertSame(SourceType::GithubPat, $document->source_type);
        $this->assertSame($integration->id, $document->integration_id);
        // The PAT authenticated the listing calls too.
        $this->assertSame('Bearer '.self::TOKEN, $transport->requests[0]->headers['Authorization']);
    }

    public function test_a_matched_path_with_url_special_characters_mints_an_encoded_blob_source(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        // A git filename may legitimately hold a '#' or a space — concatenated raw
        // into the blob URL, parse_url would truncate the source at the fragment and
        // the import would 404 forever. Each path segment must be URL-encoded.
        $transport->respond(200, [], $this->tree(false, ['docs/RFC #12.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $document = Document::query()->where('tracked_repo_id', $trackedRepo->id)->firstOrFail();
        $this->assertSame('docs/RFC #12.md', $document->tracked_path);
        // Per-segment rawurlencode, slashes preserved as separators — the blob
        // connector decodes this back and re-encodes to the same contents API URL.
        $this->assertSame(
            'https://github.com/kedgehq/kedge/blob/main/docs/RFC%20%2312.md',
            $document->source_url,
        );
    }

    // ---- report = discovery outcomes, written atomically -------------------

    public function test_the_report_records_discovery_outcomes_with_counts_and_duration(): void
    {
        $trackedRepo = $this->scan(['docs/a.md', 'docs/b.md']);

        $report = $trackedRepo->last_scan_report;

        $this->assertSame('ok', $report['status']);
        $this->assertSame('main', $report['ref']);
        $this->assertSame(2, $report['matched']);
        $this->assertSame(
            ['import_queued' => 2, 'resync_queued' => 0, 'unchanged' => 0, 'missing' => 0, 'failed' => 0],
            $report['counts'],
        );
        $this->assertIsInt($report['duration_ms']);
        $this->assertGreaterThanOrEqual(0, $report['duration_ms']);
        $this->assertArrayHasKey('started_at', $report);
        $this->assertArrayHasKey('finished_at', $report);
        $this->assertFalse($report['stale_takeover']);
        $this->assertNull($report['error']);

        $outcomes = collect($report['files'])->keyBy('path');
        $this->assertSame('import_queued', $outcomes['docs/a.md']['outcome']);
        $this->assertNotNull($outcomes['docs/a.md']['document_id']);

        $this->assertSame(TrackedScanStatus::Ok, $trackedRepo->last_scan_status);
    }

    public function test_an_already_tracked_path_is_unchanged_and_not_reimported(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);
        // A document this repo already imported from docs/a.md, its recorded blob
        // sha matching the tree's — so the diff reads it as genuinely unchanged.
        $existing = Document::factory()->for($user->personalWorkspace())->create([
            'tracked_repo_id' => $trackedRepo->id,
            'tracked_path' => 'docs/a.md',
            'tracked_blob_sha' => sha1('docs/a.md'),
            'status' => DocumentStatus::Ready,
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md', 'docs/b.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $report = $trackedRepo->fresh()->last_scan_report;
        $this->assertSame(
            ['import_queued' => 1, 'resync_queued' => 0, 'unchanged' => 1, 'missing' => 0, 'failed' => 0],
            $report['counts'],
        );

        $outcomes = collect($report['files'])->keyBy('path');
        $this->assertSame('unchanged', $outcomes['docs/a.md']['outcome']);
        $this->assertSame($existing->id, $outcomes['docs/a.md']['document_id']);
        $this->assertSame('import_queued', $outcomes['docs/b.md']['outcome']);

        // Only the new file was imported; the held one was left untouched.
        Queue::assertPushed(ImportDocumentJob::class, 1);
        $this->assertSame(2, Document::query()->where('tracked_repo_id', $trackedRepo->id)->count());
    }

    public function test_a_per_file_failure_carries_a_reason_and_never_fails_the_scan(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        // A duplicate path forces the (tracked_repo_id, tracked_path) unique index to
        // reject the second create — a real discovery-time doc-creation failure.
        $transport->respond(200, [], $this->tree(false, ['docs/a.md', 'docs/a.md', 'docs/b.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $trackedRepo->refresh();
        // The scan still completed ok — one rotten file can't block the rest (13).
        $this->assertSame(TrackedScanStatus::Ok, $trackedRepo->last_scan_status);

        $report = $trackedRepo->last_scan_report;
        // The duplicate docs/a.md: the first create wins (import_queued), the second
        // trips the unique index (failed); docs/b.md imports cleanly.
        $this->assertSame(1, $report['counts']['failed']);
        $this->assertSame(2, $report['counts']['import_queued']);

        $failed = collect($report['files'])->firstWhere('outcome', 'failed');
        $this->assertNotNull($failed['reason']);
        $this->assertNull($failed['document_id']);
    }

    // ---- repo-level failures (4A, story 18) --------------------------------

    public function test_an_over_cap_match_is_a_repo_level_failure_naming_the_count(): void
    {
        config(['kedge.tracked_repos.file_cap' => 2]);

        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md', 'docs/b.md', 'docs/c.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $trackedRepo->refresh();
        $this->assertSame(TrackedScanStatus::Failed, $trackedRepo->last_scan_status);
        $this->assertStringContainsString('3', (string) $trackedRepo->scan_error);
        $this->assertSame('over_cap', $trackedRepo->last_scan_report['error']['code']);
        $this->assertSame([], $trackedRepo->last_scan_report['files']);
        // Nothing imported on a repo-level failure.
        $this->assertSame(0, Document::query()->where('tracked_repo_id', $trackedRepo->id)->count());
    }

    public function test_a_truncated_listing_is_a_repo_level_failure(): void
    {
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(true, ['docs/a.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $trackedRepo->refresh();
        $this->assertSame(TrackedScanStatus::Failed, $trackedRepo->last_scan_status);
        $this->assertSame('truncated', $trackedRepo->last_scan_report['error']['code']);
        $this->assertSame(0, Document::query()->where('tracked_repo_id', $trackedRepo->id)->count());
    }

    public function test_a_non_branch_ref_is_a_repo_level_failure(): void
    {
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => 'v1.0.0',
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));       // reachability probe
        $transport->respond(404, [], json_encode(['message' => 'Branch not found']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $trackedRepo->refresh();
        $this->assertSame(TrackedScanStatus::Failed, $trackedRepo->last_scan_status);
        $this->assertSame('invalid_ref', $trackedRepo->last_scan_report['error']['code']);
    }

    // ---- concurrency guard (5A, story 15) ----------------------------------

    public function test_exactly_one_of_two_concurrent_claims_wins(): void
    {
        $trackedRepo = TrackedRepo::factory()->create();
        $service = app(TrackedRepoScanService::class);
        $now = CarbonImmutable::now();

        $first = $service->claim($trackedRepo, $now);
        // The second claim re-reads the row the first just marked running.
        $second = $service->claim($trackedRepo->fresh(), $now);

        $this->assertTrue($first->claimed);
        $this->assertFalse($second->claimed);
        $this->assertFalse($first->staleTakeover);
        $this->assertSame(TrackedScanStatus::Running, $trackedRepo->fresh()->last_scan_status);
    }

    public function test_a_losing_claimant_no_ops_without_touching_the_report(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $trackedRepo = TrackedRepo::factory()->create([
            'last_scan_status' => TrackedScanStatus::Running,
            'last_scanned_at' => CarbonImmutable::now(), // fresh — not stale
        ]);

        // No GitHub is scripted: a losing claimant must return before any listing.
        $this->bindGithub();
        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh());

        $trackedRepo->refresh();
        $this->assertSame(TrackedScanStatus::Running, $trackedRepo->last_scan_status);
        $this->assertNull($trackedRepo->last_scan_report);
        Queue::assertNothingPushed();
    }

    public function test_a_stale_running_claim_is_reclaimable_and_the_takeover_is_noted(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
            'last_scan_status' => TrackedScanStatus::Running,
            // A crashed worker's claim, older than the stale bound.
            'last_scanned_at' => CarbonImmutable::now()->subMinutes(TrackedRepoScanService::STALE_MINUTES + 5),
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md']));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        $trackedRepo->refresh();
        $this->assertSame(TrackedScanStatus::Ok, $trackedRepo->last_scan_status);
        $this->assertTrue($trackedRepo->last_scan_report['stale_takeover']);
    }

    // ---- logging + audit (story 20) ----------------------------------------

    public function test_a_scan_is_audit_logged(): void
    {
        $trackedRepo = $this->scan(['docs/a.md'], actorEmail: 'author@example.com');

        $entry = AuditLog::query()->where('action', 'tracked_repo.scanned')->latest('id')->first();
        $this->assertNotNull($entry);
        $this->assertSame($trackedRepo->id, $entry->subject_id);
        $this->assertSame('ok', $entry->meta['status']);
        $this->assertSame(1, $entry->meta['matched']);
    }

    public function test_creating_a_tracked_repo_is_audit_logged(): void
    {
        Queue::fake([ImportDocumentJob::class]);
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md']));

        $user = $this->registerUser();
        $this->actingAs($user)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
        ])->assertStatus(202);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'tracked_repo.created',
            'user_id' => $user->id,
        ]);
    }

    // ---- show (poll target) ------------------------------------------------

    public function test_show_serves_the_record_running_state_and_last_report(): void
    {
        $trackedRepo = $this->scan(['docs/a.md']);
        $user = $trackedRepo->workspace->members()->firstOrFail();

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/tracked-repos/{$trackedRepo->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $trackedRepo->id)
            ->assertJsonPath('data.last_scan_status', 'ok')
            ->assertJsonPath('data.last_scan_report.counts.import_queued', 1);
    }

    public function test_show_reports_a_running_scan(): void
    {
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'last_scan_status' => TrackedScanStatus::Running,
        ]);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/tracked-repos/{$trackedRepo->id}")
            ->assertOk()
            ->assertJsonPath('data.last_scan_status', 'running');
    }

    // ---- re-scan trigger idempotency (story 15) ----------------------------

    public function test_the_scan_endpoint_is_an_idempotent_202(): void
    {
        Queue::fake([ImportDocumentJob::class, ScanTrackedRepoJob::class]);
        $user = $this->registerUser();
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/tracked-repos/{$trackedRepo->id}/scan")
            ->assertStatus(202);

        Queue::assertPushed(ScanTrackedRepoJob::class, 1);
    }

    // ---- policy / IDOR -----------------------------------------------------

    public function test_a_foreign_tracked_repo_is_denied(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $foreign = TrackedRepo::factory()->for($owner->personalWorkspace())->create();

        $this->actingAs($stranger)->fromWebApp()
            ->getJson("/api/v1/tracked-repos/{$foreign->id}")
            ->assertForbidden();

        $this->actingAs($stranger)->fromWebApp()
            ->postJson("/api/v1/tracked-repos/{$foreign->id}/scan")
            ->assertForbidden();
    }

    public function test_a_foreign_project_target_404s_on_create_without_a_scan(): void
    {
        Queue::fake();
        $owner = $this->registerUser('owner@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $foreign = Project::factory()->for($owner->personalWorkspace())->create();

        $this->actingAs($stranger)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
            'project_id' => $foreign->id,
        ])->assertNotFound();

        $this->assertDatabaseCount('tracked_repos', 0);
        Queue::assertNothingPushed();
    }

    public function test_a_workspaceless_reviewer_is_refused_403(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
        ])->assertForbidden();
    }

    public function test_create_requires_authentication(): void
    {
        $this->fromWebApp()->postJson('/api/v1/tracked-repos', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => 'docs/**',
        ])->assertUnauthorized();
    }

    public function test_repo_url_and_path_pattern_are_required_on_create(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/tracked-repos', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['repo_url', 'path_pattern']);
    }

    // ---- index -------------------------------------------------------------

    public function test_index_lists_the_workspaces_tracked_repos_filtered_by_project(): void
    {
        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create();
        $inProject = TrackedRepo::factory()->for($user->personalWorkspace())->create(['project_id' => $project->id]);
        TrackedRepo::factory()->for($user->personalWorkspace())->create(['project_id' => null]);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/tracked-repos?project={$project->id}")
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame($inProject->id, $response->json('data.0.id'));
    }

    // ---- helpers -----------------------------------------------------------

    private function registerUser(string $email = 'author@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Doc Author',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    /**
     * Create a public tracked repo, script metadata+tree for the given paths, run
     * the scan inline (import jobs faked), and return the refreshed record.
     *
     * @param  list<string>  $paths
     */
    private function scan(array $paths, string $actorEmail = 'author@example.com'): TrackedRepo
    {
        Queue::fake([ImportDocumentJob::class]);
        $user = $this->registerUser($actorEmail);
        $trackedRepo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, $paths));

        app(TrackedRepoScanService::class)->scan($trackedRepo->fresh(), $user->id);

        return $trackedRepo->fresh();
    }

    private function bindGithub(): FakeHttpTransport
    {
        $dns = new FakeDnsResolver;
        $dns->set('api.github.com', ['140.82.112.3']);

        $transport = new FakeHttpTransport;

        $this->app->instance(DnsResolver::class, $dns);
        $this->app->instance(HttpTransport::class, $transport);

        return $transport;
    }

    private function metadata(string $defaultBranch): string
    {
        return (string) json_encode(['default_branch' => $defaultBranch]);
    }

    /**
     * A git-tree listing fixture. Each blob carries a deterministic git blob sha
     * (sha1 of its path) so the re-scan diff has a stable change signal; pass
     * `$shas` to override a path's sha and simulate an upstream change (#94).
     *
     * @param  list<string>  $paths
     * @param  array<string, string>  $shas
     */
    private function tree(bool $truncated, array $paths, array $shas = []): string
    {
        $entries = array_map(
            fn (string $path): array => [
                'path' => $path,
                'type' => str_contains($path, '.') ? 'blob' : 'tree',
                'sha' => $shas[$path] ?? sha1($path),
            ],
            $paths,
        );

        return (string) json_encode(['sha' => str_repeat('b', 40), 'truncated' => $truncated, 'tree' => $entries]);
    }
}
