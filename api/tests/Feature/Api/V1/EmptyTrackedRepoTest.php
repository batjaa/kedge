<?php

namespace Tests\Feature\Api\V1;

use App\Enums\TrackedScanStatus;
use App\Models\Integration;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\RegistrationService;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

class EmptyTrackedRepoTest extends TestCase
{
    use RefreshDatabase;

    private const REPO_URL = 'https://github.com/example/empty';

    private const MESSAGE = 'This repository has no commits yet. Push an initial commit containing your documents, then try again.';

    public static function refs(): array
    {
        return ['default branch' => [null], 'explicit branch' => ['main']];
    }

    #[DataProvider('refs')]
    public function test_preview_explains_an_empty_repo_without_suggesting_new_credentials(?string $ref): void
    {
        $user = $this->author();
        $token = 'ghp_emptyRepoTestToken';
        Integration::factory()->for($user->personalWorkspace())->withToken($token)->create();
        $transport = $this->emptyRepo($ref);

        $this->actingAs($user)->fromWebApp()->postJson('/api/v1/tracked-repos/preview', [
            'repo_url' => self::REPO_URL,
            'ref' => $ref,
            'path_pattern' => '**/*.md',
        ])->assertStatus(422)
            ->assertJsonPath('error', 'empty_repository')
            ->assertJsonPath('message', self::MESSAGE)
            ->assertJsonMissingPath('files');

        foreach ($transport->requests as $request) {
            $this->assertSame('Bearer '.$token, $request->headers['Authorization']);
        }
        $this->assertDatabaseCount('tracked_repos', 0);
        $this->assertDatabaseCount('documents', 0);
    }

    #[DataProvider('refs')]
    public function test_scan_records_an_empty_repo_failure_without_importing_documents(?string $ref): void
    {
        $user = $this->author();
        $repo = TrackedRepo::factory()->for($user->personalWorkspace())->create([
            'repo_url' => self::REPO_URL,
            'ref' => $ref,
            'path_pattern' => '**/*.md',
        ]);
        $this->emptyRepo($ref);

        app(TrackedRepoScanService::class)->scan($repo, $user->id);

        $repo->refresh();
        $this->assertSame(TrackedScanStatus::Failed, $repo->last_scan_status);
        $this->assertSame(self::MESSAGE, $repo->scan_error);
        $this->assertSame('empty_repository', $repo->last_scan_report['error']['code']);
        $this->assertSame([], $repo->last_scan_report['files']);
        $this->assertDatabaseCount('documents', 0);
    }

    public function test_an_unrelated_conflict_is_not_reported_as_an_empty_repo(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], '{"default_branch":"main"}');
        $transport->respond(409, [], '{"message":"Another conflict"}');

        $this->actingAs($this->author())->fromWebApp()->postJson('/api/v1/tracked-repos/preview', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => '**/*.md',
        ])->assertStatus(422)->assertJsonPath('error', 'unreachable');
    }

    public function test_a_valid_tree_with_zero_matching_documents_is_still_a_successful_preview(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], '{"default_branch":"main","size":0}');
        $transport->respond(200, [], '{"truncated":false,"tree":[{"type":"blob","path":"app.php"}]}');

        $this->actingAs($this->author())->fromWebApp()->postJson('/api/v1/tracked-repos/preview', [
            'repo_url' => self::REPO_URL,
            'path_pattern' => '**/*.md',
        ])->assertOk()->assertJsonPath('count', 0)->assertJsonPath('files', []);
    }

    public function test_a_failed_empty_repo_probe_preserves_the_missing_branch_error(): void
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], '{"default_branch":"main"}');
        $transport->respond(404, [], '{"message":"Branch not found"}');
        $transport->respond(503, [], '{"message":"Service unavailable"}');

        $this->actingAs($this->author())->fromWebApp()->postJson('/api/v1/tracked-repos/preview', [
            'repo_url' => self::REPO_URL,
            'ref' => 'missing',
            'path_pattern' => '**/*.md',
        ])->assertStatus(422)->assertJsonPath('error', 'invalid_ref');
    }

    private function author(): User
    {
        $user = app(RegistrationService::class)->register('Author', 'author@example.com', 'correct-horse-battery');
        $user->markEmailAsVerified();

        return $user;
    }

    private function emptyRepo(?string $ref): FakeHttpTransport
    {
        $transport = $this->bindGithub();
        $transport->respond(200, [], '{"default_branch":"main","size":0}');
        if ($ref !== null) {
            $transport->respond(404, [], '{"message":"Branch not found"}');
        }
        $transport->respond(409, [], '{"message":"Git Repository is empty."}');

        return $transport;
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
}
