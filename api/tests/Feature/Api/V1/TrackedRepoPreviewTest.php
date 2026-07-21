<?php

namespace Tests\Feature\Api\V1;

use App\Models\Document;
use App\Models\Integration;
use App\Models\Project;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The tracked-repo preview endpoint (SPEC §16, M3.6; stories 7, 8, 18; decisions
 * 2A/4A/9A/10A). Preview is READ-ONLY — it lists exactly which files a scan would
 * import — so every case here is proven with the GitHub boundary faked (recorded
 * repo/branches/tree shapes replayed through the real SSRF-guarded fetcher), the
 * cheapest seam with full control of upstream state. Nothing persists.
 */
class TrackedRepoPreviewTest extends TestCase
{
    use RefreshDatabase;

    private const REPO_URL = 'https://github.com/kedgehq/kedge';

    private const TOKEN = 'ghp_previewSECRETtoken1111111111111111abcd';

    // ---- matches + allowlist intersection ----------------------------------

    public function test_previews_matching_files_intersected_with_the_importable_allowlist(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, [
            'docs/spec.md',            // matches, importable
            'docs/nested/design.mdx',  // matches, importable
            'docs/notes.txt',          // matches pattern, NOT importable → dropped
            'docs',                    // a directory → dropped (type=tree)
            'README.md',               // importable but outside docs/ → not matched
        ]));

        $response = $this->preview(['path_pattern' => 'docs/**']);

        $response->assertOk()
            ->assertJsonPath('ref', 'main')
            ->assertJsonPath('count', 2)
            ->assertJsonPath('overlap_count', 0);

        $paths = array_column($response->json('files'), 'path');
        $this->assertSame(['docs/nested/design.mdx', 'docs/spec.md'], $paths);
    }

    public function test_the_pattern_is_case_sensitive_end_to_end(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/A.md', 'docs/b.MD', 'docs/c.md']));

        // `docs/*.md` (lowercase) matches only the lowercase-extension .md paths;
        // `.MD` is a different string (git paths are case-sensitive) and drops out.
        $paths = array_column($this->preview(['path_pattern' => 'docs/*.md'])->json('files'), 'path');

        $this->assertSame(['docs/A.md', 'docs/c.md'], $paths);
    }

    // ---- default branch resolution -----------------------------------------

    public function test_resolves_the_default_branch_when_the_ref_is_omitted(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('trunk'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md']));

        $this->preview(['path_pattern' => 'docs/**'])->assertOk()->assertJsonPath('ref', 'trunk');

        // Two calls: repo metadata (for the default branch), then the tree at it.
        $this->assertCount(2, $transport->requests);
        $this->assertStringContainsString('/repos/kedgehq/kedge', $transport->requests[0]->url);
        $this->assertStringContainsString('/git/trees/trunk?recursive=1', $transport->requests[1]->url);
    }

    public function test_a_provided_branch_is_confirmed_and_used(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));    // reachability probe
        $transport->respond(200, [], $this->branch('develop'));   // confirms it is a branch
        $transport->respond(200, [], $this->tree(false, ['docs/a.md']));

        $this->preview(['ref' => 'develop', 'path_pattern' => 'docs/**'])
            ->assertOk()
            ->assertJsonPath('ref', 'develop');

        $this->assertCount(3, $transport->requests);
        $this->assertStringContainsString('/branches/develop', $transport->requests[1]->url);
        $this->assertStringContainsString('/git/trees/develop?recursive=1', $transport->requests[2]->url);
    }

    // ---- branch-only refs (2A) ---------------------------------------------

    public function test_a_tag_ref_is_rejected_as_not_a_branch(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(404, [], json_encode(['message' => 'Branch not found']));

        $this->preview(['ref' => 'v1.2.0', 'path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'invalid_ref')
            ->assertJsonPath('message', fn (string $m): bool => str_contains($m, 'branch'));

        // No tree call once the ref fails the branch check.
        $this->assertCount(2, $transport->requests);
    }

    public function test_a_commit_sha_ref_is_rejected_as_not_a_branch(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(404, [], json_encode(['message' => 'Branch not found']));

        $this->preview(['ref' => 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', 'path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'invalid_ref');

        $this->assertCount(2, $transport->requests);
    }

    // ---- over-cap (story 18) -----------------------------------------------

    public function test_over_cap_is_an_explicit_error_naming_the_count(): void
    {
        config(['kedge.tracked_repos.file_cap' => 2]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md', 'docs/b.md', 'docs/c.md']));

        $this->preview(['path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'over_cap')
            ->assertJsonPath('count', 3)
            ->assertJsonPath('cap', 2)
            ->assertJsonPath('message', fn (string $m): bool => str_contains($m, '3'));
    }

    // ---- truncation (4A) ----------------------------------------------------

    public function test_a_truncated_listing_is_an_explicit_error_never_a_partial_match(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(true, ['docs/a.md']));

        $this->preview(['path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'truncated')
            // No `files` key — truncation never returns a partial set.
            ->assertJsonMissingPath('files');
    }

    // ---- overlap warnings (10A) --------------------------------------------

    public function test_overlap_warns_on_paths_already_tracked_elsewhere_in_the_workspace(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();

        // Another tracked repo in this workspace already holds docs/spec.md.
        $other = TrackedRepo::factory()->for($workspace)->create();
        Document::factory()->for($workspace)->create([
            'tracked_repo_id' => $other->id,
            'tracked_path' => 'docs/spec.md',
        ]);

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/spec.md', 'docs/design.md']));

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [
                'repo_url' => self::REPO_URL,
                'path_pattern' => 'docs/**',
            ]);

        $response->assertOk()->assertJsonPath('overlap_count', 1);

        $files = collect($response->json('files'))->keyBy('path');
        $this->assertTrue($files['docs/spec.md']['overlap']);
        $this->assertFalse($files['docs/design.md']['overlap']);
    }

    // ---- auth posture -------------------------------------------------------

    public function test_the_workspace_pat_authenticates_the_listing_when_connected(): void
    {
        $user = $this->registerUser();
        Integration::factory()->withToken(self::TOKEN)->for($user->personalWorkspace())->create();

        $transport = $this->bindGithub();
        $transport->respond(200, [], $this->metadata('main'));
        $transport->respond(200, [], $this->tree(false, ['docs/a.md']));

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [
                'repo_url' => self::REPO_URL,
                'path_pattern' => 'docs/**',
            ])->assertOk();

        // The PAT rode every outbound listing call (private repos + higher quota).
        $this->assertSame('Bearer '.self::TOKEN, $transport->requests[0]->headers['Authorization']);
    }

    // ---- upstream failure surfaces -----------------------------------------

    public function test_an_unreachable_repo_is_a_clean_error(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(404, [], json_encode(['message' => 'Not Found']));

        $this->preview(['path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'unreachable');
    }

    public function test_a_denied_repo_surfaces_the_reconnect_recovery(): void
    {
        $transport = $this->bindGithub();
        // A non-throttle 403 (budget intact) — a genuine access denial, not a limit.
        $transport->respond(403, ['X-RateLimit-Remaining' => '59'], json_encode(['message' => 'Forbidden']));

        $this->preview(['path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'unauthorized')
            ->assertJsonPath('message', fn (string $m): bool => str_contains($m, 'Reconnect') || str_contains($m, 'PAT'));
    }

    public function test_a_rate_limited_listing_backs_off_rather_than_reading_as_denied(): void
    {
        $transport = $this->bindGithub();
        // 403 with the budget spent is a throttle, classified before the auth guard.
        $transport->respond(403, ['X-RateLimit-Remaining' => '0'], json_encode(['message' => 'API rate limit exceeded']));

        $this->preview(['path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'rate_limited');
    }

    // ---- input validation ---------------------------------------------------

    public function test_a_non_github_repo_url_is_unsupported_without_any_fetch(): void
    {
        $transport = $this->bindGithub();

        $this->preview(['repo_url' => 'https://example.com/owner/repo', 'path_pattern' => 'docs/**'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'unsupported_repo');

        // Parsing fails before any outbound call.
        $this->assertCount(0, $transport->requests);
    }

    public function test_a_traversing_pattern_is_rejected_before_any_fetch(): void
    {
        $transport = $this->bindGithub();

        $this->preview(['path_pattern' => 'docs/../secrets/*.md'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'invalid_pattern');

        $this->assertCount(0, $transport->requests);
    }

    public function test_repo_url_and_path_pattern_are_required(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['repo_url', 'path_pattern']);
    }

    // ---- policy / IDOR ------------------------------------------------------

    public function test_a_foreign_project_target_404s_without_a_fetch(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        // A project in ANOTHER workspace is never an access path (8A).
        $foreign = Project::factory()->for($owner->personalWorkspace())->create();

        $transport = $this->bindGithub();

        $this->actingAs($stranger)->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [
                'repo_url' => self::REPO_URL,
                'path_pattern' => 'docs/**',
                'project_id' => $foreign->id,
            ])
            ->assertNotFound();

        $this->assertCount(0, $transport->requests);
    }

    public function test_a_workspaceless_reviewer_is_refused_403_not_500(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [
                'repo_url' => self::REPO_URL,
                'path_pattern' => 'docs/**',
            ])
            ->assertForbidden();
    }

    public function test_preview_requires_authentication(): void
    {
        $this->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', [
                'repo_url' => self::REPO_URL,
                'path_pattern' => 'docs/**',
            ])
            ->assertUnauthorized();
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

    /**
     * POST the preview as a fresh authenticated user with the given overrides
     * merged over sensible defaults (repo URL + pattern).
     */
    private function preview(array $body): TestResponse
    {
        return $this->actingAs($this->registerUser())->fromWebApp()
            ->postJson('/api/v1/tracked-repos/preview', array_merge([
                'repo_url' => self::REPO_URL,
            ], $body));
    }

    /**
     * Bind the SSRF fetcher to a scriptable HTTP boundary with api.github.com
     * pinned to a public address (mirrors the connector suites). Script responses
     * on the returned transport in call order.
     */
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

    private function branch(string $name): string
    {
        return (string) json_encode(['name' => $name, 'commit' => ['sha' => str_repeat('a', 40)]]);
    }

    /**
     * @param  list<string>  $paths
     */
    private function tree(bool $truncated, array $paths): string
    {
        $entries = array_map(
            fn (string $path): array => [
                'path' => $path,
                // A path with no extension stands in for a directory entry.
                'type' => str_contains($path, '.') ? 'blob' : 'tree',
            ],
            $paths,
        );

        return (string) json_encode(['sha' => str_repeat('b', 40), 'truncated' => $truncated, 'tree' => $entries]);
    }
}
