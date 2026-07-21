<?php

namespace Tests\Feature\Api\V1;

use App\Models\Project;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Projects CRUD + the name rules (6A) and the policy/IDOR matrix (SPEC §16,
 * M3.6). Projects are workspace-scoped containers: an id in a URL is never an
 * access path, so a cross-workspace project is invisible to the list and a
 * foreign project id is never mutable, and a workspace-less reviewer is refused
 * 403 (never a 500).
 */
class ProjectTest extends TestCase
{
    use RefreshDatabase;

    // ---- create ------------------------------------------------------------

    public function test_creates_a_project_in_the_callers_workspace(): void
    {
        $user = $this->registerUser();

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => 'Anchoring', 'description' => 'The re-anchoring effort.']);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'Anchoring')
            ->assertJsonPath('data.description', 'The re-anchoring effort.')
            ->assertJsonPath('data.documents_count', 0);

        $this->assertDatabaseHas('projects', [
            'workspace_id' => $user->personalWorkspace()->id,
            'name' => 'Anchoring',
            'created_by' => $user->id,
        ]);

        // A slug is derived from the name.
        $this->assertSame('anchoring', Project::first()->slug);
    }

    public function test_name_is_required(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_name_is_capped_at_100_characters(): void
    {
        $user = $this->registerUser();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => str_repeat('a', 101)])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);

        // The boundary is inclusive — exactly 100 is accepted.
        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => str_repeat('a', 100)])
            ->assertCreated();
    }

    public function test_name_is_unique_per_workspace_with_a_friendly_message(): void
    {
        $user = $this->registerUser();
        Project::factory()->for($user->personalWorkspace())->create(['name' => 'Anchoring']);

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => 'Anchoring']);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name']);

        // Friendly, not the raw "validation.unique" key (6A).
        $this->assertSame(
            'A project with that name already exists in this workspace.',
            $response->json('errors.name.0'),
        );
    }

    public function test_the_same_name_is_allowed_in_a_different_workspace(): void
    {
        $userA = $this->registerUser('a@example.com');
        $userB = $this->registerUser('b@example.com');
        Project::factory()->for($userB->personalWorkspace())->create(['name' => 'Anchoring']);

        // Uniqueness is scoped to the caller's own workspace — B's project name
        // never probes or blocks A's (no cross-workspace existence leak).
        $this->actingAs($userA)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => 'Anchoring'])
            ->assertCreated();
    }

    public function test_a_workspaceless_reviewer_cannot_create_a_project(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->postJson('/api/v1/projects', ['name' => 'Anchoring'])
            ->assertForbidden();
    }

    // ---- index -------------------------------------------------------------

    public function test_lists_the_workspaces_projects_name_ordered(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        Project::factory()->for($workspace)->create(['name' => 'Zebra']);
        Project::factory()->for($workspace)->create(['name' => 'Anchoring']);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/projects');

        $response->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Anchoring')
            ->assertJsonPath('data.1.name', 'Zebra');
    }

    public function test_index_scopes_strictly_to_the_callers_workspace(): void
    {
        $userA = $this->registerUser('a@example.com');
        $userB = $this->registerUser('b@example.com');
        $mine = Project::factory()->for($userA->personalWorkspace())->create(['name' => 'Mine']);
        $theirs = Project::factory()->for($userB->personalWorkspace())->create(['name' => 'Theirs']);

        $response = $this->actingAs($userA)->fromWebApp()
            ->getJson('/api/v1/projects');

        $response->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);

        // Another workspace's project is invisible, id and all.
        $this->assertNotContains($theirs->id, array_column($response->json('data'), 'id'));
    }

    public function test_a_workspaceless_reviewer_is_refused_403_not_500_on_index(): void
    {
        $reviewer = User::factory()->create();
        $this->assertNull($reviewer->personalWorkspace());

        $this->actingAs($reviewer)->fromWebApp()
            ->getJson('/api/v1/projects')
            ->assertForbidden();
    }

    public function test_index_requires_authentication(): void
    {
        $this->fromWebApp()->getJson('/api/v1/projects')->assertUnauthorized();
    }

    // ---- update ------------------------------------------------------------

    public function test_renames_a_project_and_edits_its_description(): void
    {
        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create([
            'name' => 'Old name',
            'description' => 'Old description.',
        ]);

        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/projects/{$project->id}", [
                'name' => 'New name',
                'description' => 'New description.',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'New name')
            ->assertJsonPath('data.description', 'New description.');

        $this->assertDatabaseHas('projects', [
            'id' => $project->id,
            'name' => 'New name',
            'description' => 'New description.',
        ]);
    }

    public function test_a_no_op_rename_to_the_same_name_succeeds(): void
    {
        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create(['name' => 'Anchoring']);

        // Unique-ignoring-self: renaming a project to its own current name must
        // not collide with its own row.
        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/projects/{$project->id}", ['name' => 'Anchoring'])
            ->assertOk();
    }

    public function test_a_rename_that_collides_with_a_sibling_is_422(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        Project::factory()->for($workspace)->create(['name' => 'Taken']);
        $project = Project::factory()->for($workspace)->create(['name' => 'Free']);

        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/projects/{$project->id}", ['name' => 'Taken'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_a_cross_workspace_project_cannot_be_updated(): void
    {
        $owner = $this->registerUser('owner@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $project = Project::factory()->for($owner->personalWorkspace())->create(['name' => 'Private']);

        // A foreign project id is never an access path — the policy denies (403),
        // never a mutation.
        $this->actingAs($stranger)->fromWebApp()
            ->patchJson("/api/v1/projects/{$project->id}", ['name' => 'Hijacked'])
            ->assertForbidden();

        $this->assertDatabaseHas('projects', ['id' => $project->id, 'name' => 'Private']);
    }

    public function test_a_workspaceless_reviewer_cannot_update_a_project(): void
    {
        $owner = $this->registerUser();
        $reviewer = User::factory()->create();
        $project = Project::factory()->for($owner->personalWorkspace())->create();

        $this->actingAs($reviewer)->fromWebApp()
            ->patchJson("/api/v1/projects/{$project->id}", ['name' => 'Nope'])
            ->assertForbidden();
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
}
