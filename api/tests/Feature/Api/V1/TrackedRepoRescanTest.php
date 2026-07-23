<?php

namespace Tests\Feature\Api\V1;

use App\Enums\AnchorState;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Jobs\ImportDocumentJob;
use App\Jobs\ResyncDocumentJob;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Project;
use App\Models\Thread;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\RegistrationService;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The re-scan diff matrix (SPEC §16, M3.6, #94; stories 10/11/16/17). Extends the
 * #93 first-scan pipeline: a re-scan over a repo that already holds documents
 * resolves each matched path to new / changed / unchanged and each held-but-gone
 * path to missing — proven here, the cheapest seam with full control of upstream
 * state. The GitHub boundary is faked (recorded tree/blob shapes replayed through
 * the real SSRF-guarded fetcher); tests assert what the workspace holds and the
 * record reports, never the scan's internal ordering.
 */
class TrackedRepoRescanTest extends TestCase
{
    use RefreshDatabase;

    private const REPO_URL = 'https://github.com/kedgehq/kedge';

    // ---- the full outcome matrix in one scan (acceptance gate) --------------

    public function test_a_re_scan_produces_new_changed_unchanged_and_missing_in_one_scan(): void
    {
        Queue::fake([ImportDocumentJob::class, ResyncDocumentJob::class]);
        $user = $this->registerUser();
        $repo = $this->trackedRepo($user);

        // docs/changed.md: held, its recorded sha differs from the tree's → changed.
        $changed = $this->heldDoc($user, $repo, 'docs/changed.md', str_repeat('0', 40), withVersion: true);
        // docs/same.md: held, recorded sha matches the tree's default → unchanged.
        $same = $this->heldDoc($user, $repo, 'docs/same.md', sha1('docs/same.md'));
        // docs/gone.md: held, no longer in the tree → missing (untouched).
        $gone = $this->heldDoc($user, $repo, 'docs/gone.md', sha1('docs/gone.md'));

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        // docs/new.md is new; docs/changed.md + docs/same.md are held; docs/gone.md absent.
        $transport->respond(200, [], $this->tree(['docs/new.md', 'docs/changed.md', 'docs/same.md']));

        app(TrackedRepoScanService::class)->scan($repo->fresh(), $user->id);

        $report = $repo->fresh()->last_scan_report;
        $this->assertSame('ok', $report['status']);
        $this->assertSame(3, $report['matched']); // missing is reported but not "matched"
        $this->assertSame([
            'import_queued' => 1,
            'resync_queued' => 1,
            'unchanged' => 1,
            'missing' => 1,
            'failed' => 0,
        ], $report['counts']);

        $outcomes = collect($report['files'])->keyBy('path');
        $this->assertSame('import_queued', $outcomes['docs/new.md']['outcome']);
        $this->assertSame('resync_queued', $outcomes['docs/changed.md']['outcome']);
        $this->assertSame($changed->id, $outcomes['docs/changed.md']['document_id']);
        $this->assertSame('unchanged', $outcomes['docs/same.md']['outcome']);
        $this->assertSame('missing', $outcomes['docs/gone.md']['outcome']);
        $this->assertSame($gone->id, $outcomes['docs/gone.md']['document_id']);

        // New file → import; changed file → re-sync. Neither touches the others.
        Queue::assertPushed(ImportDocumentJob::class, 1);
        Queue::assertPushed(
            ResyncDocumentJob::class,
            fn (ResyncDocumentJob $job) => $job->document->is($changed) && $job->actorId === $user->id,
        );

        // The new file landed in the tracked repo's project as an importing document.
        $new = Document::query()->where('tracked_path', 'docs/new.md')->firstOrFail();
        $this->assertSame($repo->project_id, $new->project_id);
        $this->assertSame(DocumentStatus::Importing, $new->status);

        // The changed doc's recorded baseline advanced to the tree's sha.
        $this->assertSame(sha1('docs/changed.md'), $changed->fresh()->tracked_blob_sha);

        // The missing doc is untouched — never deleted, provenance intact.
        $gone->refresh();
        $this->assertNotNull($gone->tracked_repo_id);
        $this->assertSame($repo->id, $gone->tracked_repo_id);
        $this->assertSame('docs/gone.md', $gone->tracked_path);
    }

    // ---- an unchanged repo is an honest no-op (story 11) --------------------

    public function test_an_all_unchanged_re_scan_is_an_honest_no_op(): void
    {
        Queue::fake([ImportDocumentJob::class, ResyncDocumentJob::class]);
        $user = $this->registerUser();
        $repo = $this->trackedRepo($user);
        $this->heldDoc($user, $repo, 'docs/a.md', sha1('docs/a.md'));
        $this->heldDoc($user, $repo, 'docs/b.md', sha1('docs/b.md'));

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(['docs/a.md', 'docs/b.md']));

        app(TrackedRepoScanService::class)->scan($repo->fresh(), $user->id);

        $report = $repo->fresh()->last_scan_report;
        $this->assertSame('ok', $report['status']);
        $this->assertSame([
            'import_queued' => 0,
            'resync_queued' => 0,
            'unchanged' => 2,
            'missing' => 0,
            'failed' => 0,
        ], $report['counts']);

        // Nothing imported, nothing re-synced — the button is safe to press on a whim.
        Queue::assertNothingPushed();
    }

    // ---- changed-file correctness: re-sync reaches the ladder (point 4) -----

    public function test_a_changed_path_resyncs_to_a_new_version_with_a_surviving_thread(): void
    {
        // Only imports are faked — the dispatched ResyncDocumentJob runs on the sync
        // queue, so the change actually flows through the re-anchoring ladder.
        Queue::fake([ImportDocumentJob::class]);

        $user = $this->registerUser();
        $repo = $this->trackedRepo($user);

        $oldContent = "# Doc\n\nAlpha survives.\n";
        $newContent = "# Doc\n\nAlpha survives. Now updated.\n";
        $oldPlain = 'Alpha survives.';
        $newPlain = 'Alpha survives. Now updated.';

        [$document, $version] = $this->heldReadyDoc($user, $repo, 'docs/spec.md', str_repeat('0', 40), $oldContent, $oldPlain);
        $thread = $this->threadWithAnchor($document, $user, $version, $oldPlain, 'Alpha survives.');

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(['docs/spec.md'])); // default sha ≠ recorded → changed
        // The re-sync's blob fetch — the current content at the branch blob URL.
        $transport->respond(200, ['content-type' => 'text/markdown'], $newContent);

        Http::fake([
            '*/internal/projection' => Http::response([
                'plain_text' => $newPlain,
                'projection_version' => '2',
                'mdx_ok' => true,
                'warnings' => [],
            ]),
            '*/internal/reanchor' => Http::response(['results' => [[
                'threadId' => $thread->id,
                'state' => 'anchored',
                'exact' => 'Alpha survives.',
                'prefix' => '',
                'suffix' => ' Now updated.',
                'start' => 0,
                'end' => 15,
            ]]]),
        ]);

        app(TrackedRepoScanService::class)->scan($repo->fresh(), $user->id);

        // The scan reported the re-sync…
        $this->assertSame(1, $repo->fresh()->last_scan_report['counts']['resync_queued']);

        // …and (sync queue) the re-sync produced a new current version whose content
        // matches the updated fixture, with the thread surviving onto it.
        $document->refresh();
        $target = $document->currentVersion;
        $this->assertNotNull($target);
        $this->assertNotSame($version->id, $target->id);
        $this->assertSame($newContent, $target->content_raw);
        $this->assertDatabaseCount('document_versions', 2);
        $this->assertDatabaseHas('anchors', [
            'thread_id' => $thread->id,
            'document_version_id' => $target->id,
            'state' => AnchorState::Anchored->value,
        ]);
    }

    // ---- moved docs stay put; new files target the record's project (story 17)

    public function test_a_moved_doc_keeps_its_project_while_a_new_file_lands_in_the_records_project(): void
    {
        Queue::fake([ImportDocumentJob::class, ResyncDocumentJob::class]);
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        $repoProject = Project::factory()->for($workspace)->create();
        $otherProject = Project::factory()->for($workspace)->create();
        $repo = $this->trackedRepo($user, $repoProject);

        // A doc the tracked repo imported, then the author moved to another project.
        $moved = $this->heldDoc($user, $repo, 'docs/moved.md', sha1('docs/moved.md'));
        $moved->forceFill(['project_id' => $otherProject->id])->save();

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(['docs/moved.md', 'docs/fresh.md']));

        app(TrackedRepoScanService::class)->scan($repo->fresh(), $user->id);

        // The moved doc stays where the author put it — the diff never touches its project.
        $this->assertSame($otherProject->id, $moved->fresh()->project_id);

        // The new file still lands in the tracked repo's project.
        $fresh = Document::query()->where('tracked_path', 'docs/fresh.md')->firstOrFail();
        $this->assertSame($repoProject->id, $fresh->project_id);
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

    private function trackedRepo(User $user, ?Project $project = null): TrackedRepo
    {
        return TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => null,
            'path_pattern' => 'docs/**',
            'project_id' => $project?->id ?? Project::factory()->for($user->personalWorkspace())->create()->id,
        ]);
    }

    private function heldDoc(User $user, TrackedRepo $repo, string $path, ?string $sha, bool $withVersion = false): Document
    {
        $document = Document::factory()->for($user->personalWorkspace())->create([
            'project_id' => $repo->project_id,
            'tracked_repo_id' => $repo->id,
            'tracked_path' => $path,
            'tracked_blob_sha' => $sha,
            'status' => DocumentStatus::Ready,
        ]);

        if ($withVersion) {
            $version = DocumentVersion::factory()->for($document)->create();
            $document->forceFill(['current_version_id' => $version->id])->save();
        }

        return $document;
    }

    /**
     * @return array{Document, DocumentVersion}
     */
    private function heldReadyDoc(User $user, TrackedRepo $repo, string $path, string $sha, string $content, string $plain): array
    {
        $document = Document::factory()->for($user->personalWorkspace())->create([
            'project_id' => $repo->project_id,
            'tracked_repo_id' => $repo->id,
            'tracked_path' => $path,
            'tracked_blob_sha' => $sha,
            'status' => DocumentStatus::Ready,
            // A tracked-repo doc is sourced at its blob URL on the branch — the same
            // shape #93 mints, so the GitHub blob connector rewrites it to the
            // contents API on the (faked) api.github.com host.
            'source_type' => SourceType::GithubPublic,
            'source_url' => 'https://github.com/kedgehq/kedge/blob/main/'.$path,
        ]);

        $version = DocumentVersion::factory()->for($document)->create([
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'plain_text' => $plain,
            'projection_version' => '2',
        ]);
        $document->forceFill(['current_version_id' => $version->id])->save();

        return [$document->refresh(), $version];
    }

    private function threadWithAnchor(Document $document, User $author, DocumentVersion $version, string $plain, string $exact): Thread
    {
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $author->id,
        ]);
        $thread->comments()->create(['author_id' => $author->id, 'body_md' => "Comment on {$exact}"]);

        $start = mb_strpos($plain, $exact);
        $thread->anchors()->create([
            'document_version_id' => $version->id,
            'exact' => $exact,
            'prefix' => '',
            'suffix' => mb_substr($plain, $start + mb_strlen($exact), 8),
            'start' => $start,
            'end' => $start + mb_strlen($exact),
            'heading_path' => ['Doc'],
            'projection_version' => (string) $version->projection_version,
            'state' => AnchorState::Anchored,
        ]);

        return $thread->load('anchors');
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
     * A git-tree fixture: each blob carries a deterministic sha (sha1 of its path)
     * unless overridden — the re-scan change signal.
     *
     * @param  list<string>  $paths
     * @param  array<string, string>  $shas
     */
    private function tree(array $paths, array $shas = []): string
    {
        $entries = array_map(
            fn (string $path): array => [
                'path' => $path,
                'type' => 'blob',
                'sha' => $shas[$path] ?? sha1($path),
            ],
            $paths,
        );

        return (string) json_encode(['sha' => str_repeat('b', 40), 'truncated' => false, 'tree' => $entries]);
    }
}
