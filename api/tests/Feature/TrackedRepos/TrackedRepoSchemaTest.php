<?php

namespace Tests\Feature\TrackedRepos;

use App\Models\Document;
use App\Models\TrackedRepo;
use App\Models\Workspace;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The scan diff key is a database invariant, not a code convention (SPEC §16,
 * decision 1A, review-added case 13A): the composite unique index on
 * `(tracked_repo_id, tracked_path)` makes a double import structurally
 * impossible, while ordinary hand-imported documents (both columns null) never
 * collide — NULLs are distinct in a unique index.
 */
class TrackedRepoSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_tracked_repo_and_path_pair_is_unique(): void
    {
        $workspace = Workspace::factory()->create();
        $repo = TrackedRepo::factory()->for($workspace)->create();

        Document::factory()->for($workspace)->create([
            'tracked_repo_id' => $repo->id,
            'tracked_path' => 'docs/spec.md',
        ]);

        $this->expectException(QueryException::class);

        Document::factory()->for($workspace)->create([
            'tracked_repo_id' => $repo->id,
            'tracked_path' => 'docs/spec.md',
        ]);
    }

    public function test_the_same_path_under_a_different_tracked_repo_is_allowed(): void
    {
        $workspace = Workspace::factory()->create();
        $repoA = TrackedRepo::factory()->for($workspace)->create();
        $repoB = TrackedRepo::factory()->for($workspace)->create();

        Document::factory()->for($workspace)->create([
            'tracked_repo_id' => $repoA->id,
            'tracked_path' => 'docs/spec.md',
        ]);

        // A different tracked repo can hold the same repo-relative path — the pair,
        // not the path alone, is the key.
        $second = Document::factory()->for($workspace)->create([
            'tracked_repo_id' => $repoB->id,
            'tracked_path' => 'docs/spec.md',
        ]);

        $this->assertDatabaseHas('documents', ['id' => $second->id]);
    }

    public function test_hand_imported_documents_never_collide_on_the_null_pair(): void
    {
        $workspace = Workspace::factory()->create();

        // Both columns null (a normal paste/URL import) — many such rows coexist.
        Document::factory()->for($workspace)->count(3)->create([
            'tracked_repo_id' => null,
            'tracked_path' => null,
        ]);

        $this->assertSame(3, Document::whereNull('tracked_repo_id')->count());
    }

    public function test_the_project_foreign_keys_are_indexed(): void
    {
        // `constrained()` declares only the FK — Postgres and SQLite do not index
        // the referencing column off it, so the companion migration must, or the
        // home list's `?project=` filter and the panel's project read scan.
        $this->assertTrue(
            $this->hasIndexOn('documents', 'project_id'),
            'documents.project_id must be indexed (the home list filters on it).',
        );
        $this->assertTrue(
            $this->hasIndexOn('tracked_repos', 'project_id'),
            'tracked_repos.project_id must be indexed (the panel reads by project).',
        );
    }

    public function test_the_overlap_query_column_is_indexed(): void
    {
        // The workspace-wide overlap query filters documents by tracked_path alone,
        // so a standalone index must exist (the composite (tracked_repo_id,
        // tracked_path) leads with the wrong column to serve it).
        $this->assertTrue($this->hasIndexOn('documents', 'tracked_path'));
    }

    private function hasIndexOn(string $table, string $column): bool
    {
        foreach (Schema::getIndexes($table) as $index) {
            if (in_array($column, $index['columns'], true)) {
                return true;
            }
        }

        return false;
    }
}
