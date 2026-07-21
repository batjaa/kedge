<?php

namespace Tests\Feature\Api\V1;

use App\Enums\WorkspaceRole;
use App\Models\Document;
use App\Models\Project;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Assigning a document to a project and the list's `?project=` filter (SPEC §16,
 * §17, M3.6). Assignment is capability-gated exactly like lifecycle (author
 * only); a foreign project id 404s per the no-existence-leak convention (8A);
 * moving to Unfiled is clearing. The list gains the reserved `?project=` filter
 * and carries lean project identity on every row.
 */
class DocumentProjectAssignmentTest extends TestCase
{
    use RefreshDatabase;

    // ---- assignment (PATCH /documents/{id}) --------------------------------

    public function test_assigns_a_document_to_a_project(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create(['name' => 'Anchoring']);
        $document = Document::factory()->for($workspace)->create(['created_by' => $user->id]);

        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['project_id' => $project->id])
            ->assertOk()
            ->assertJsonPath('project.id', $project->id)
            ->assertJsonPath('project.name', 'Anchoring');

        $this->assertSame($project->id, $document->fresh()->project_id);
    }

    public function test_clearing_the_project_moves_a_document_to_unfiled(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create();
        $document = Document::factory()->for($workspace)->create([
            'created_by' => $user->id,
            'project_id' => $project->id,
        ]);

        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['project_id' => null])
            ->assertOk()
            ->assertJsonPath('project', null);

        $this->assertNull($document->fresh()->project_id);
    }

    public function test_a_foreign_project_id_is_404_not_an_assignment(): void
    {
        $author = $this->registerUser('author@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $document = Document::factory()->for($author->personalWorkspace())->create(['created_by' => $author->id]);
        // A project the author does NOT own — belongs to another workspace.
        $foreign = Project::factory()->for($stranger->personalWorkspace())->create();

        // The no-existence-leak convention (8A): a project id from another
        // workspace is indistinguishable from one that never existed — 404.
        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['project_id' => $foreign->id])
            ->assertNotFound();

        $this->assertNull($document->fresh()->project_id);
    }

    public function test_a_non_author_member_cannot_assign_a_project(): void
    {
        $author = $this->registerUser('author@example.com');
        $member = $this->registerUser('member@example.com');
        $workspace = $author->personalWorkspace();
        $workspace->members()->attach($member, ['role' => WorkspaceRole::Member->value]);

        $project = Project::factory()->for($workspace)->create();
        $document = Document::factory()->for($workspace)->create(['created_by' => $author->id]);

        // Assignment is capability-gated like lifecycle (author only): a plain
        // member who can review/comment cannot re-file the document.
        $this->actingAs($member)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['project_id' => $project->id])
            ->assertForbidden();

        $this->assertNull($document->fresh()->project_id);
    }

    public function test_a_document_from_another_workspace_is_404_on_assignment(): void
    {
        $author = $this->registerUser('author@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $document = Document::factory()->for($author->personalWorkspace())->create(['created_by' => $author->id]);
        $strangerProject = Project::factory()->for($stranger->personalWorkspace())->create();

        // The document itself is not the stranger's — updateLifecycle denies (403);
        // an id in a URL is never an access path.
        $this->actingAs($stranger)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['project_id' => $strangerProject->id])
            ->assertForbidden();
    }

    public function test_lifecycle_and_project_can_change_in_one_request(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create();
        $document = Document::factory()->for($workspace)->ready()->create(['created_by' => $user->id]);

        $this->actingAs($user)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", [
                'project_id' => $project->id,
                'lifecycle_status' => 'in_review',
            ])
            ->assertOk()
            ->assertJsonPath('project.id', $project->id)
            ->assertJsonPath('lifecycle_status', 'in_review');

        $fresh = $document->fresh();
        $this->assertSame($project->id, $fresh->project_id);
        $this->assertSame('in_review', $fresh->lifecycle_status->value);
    }

    // ---- import into a project (POST /documents) ---------------------------

    public function test_importing_with_a_project_files_the_document(): void
    {
        // Keep the import queued (not run inline) so the assertion is about
        // filing at store time, not the full import pipeline.
        Queue::fake();

        $user = $this->registerUser();
        $project = Project::factory()->for($user->personalWorkspace())->create(['name' => 'Anchoring']);

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [
                'content' => "# Pasted spec\n\nBody.",
                'project_id' => $project->id,
            ]);

        $response->assertStatus(202)
            ->assertJsonPath('project.id', $project->id)
            ->assertJsonPath('project.name', 'Anchoring');

        $this->assertSame($project->id, Document::first()->project_id);
    }

    public function test_importing_with_a_foreign_project_id_is_404_and_mints_no_document(): void
    {
        $user = $this->registerUser('author@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        $foreign = Project::factory()->for($stranger->personalWorkspace())->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson('/api/v1/documents', [
                'content' => "# Pasted spec\n\nBody.",
                'project_id' => $foreign->id,
            ])
            ->assertNotFound();

        // A bad project id never mints a row.
        $this->assertSame(0, Document::query()->count());
    }

    // ---- the document show carries its project ------------------------------

    public function test_show_carries_the_documents_project(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create(['name' => 'Anchoring']);
        $document = Document::factory()->for($workspace)->ready()->create([
            'created_by' => $user->id,
            'project_id' => $project->id,
        ]);

        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('project.id', $project->id)
            ->assertJsonPath('project.name', 'Anchoring');
    }

    // ---- the list filter (?project=) ---------------------------------------

    public function test_the_list_row_carries_lean_project_identity(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create(['name' => 'Anchoring']);
        Document::factory()->for($workspace)->create(['project_id' => $project->id, 'title' => 'Filed']);
        Document::factory()->for($workspace)->create(['title' => 'Unfiled']);

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents')
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('title');
        $this->assertSame(['id' => $project->id, 'name' => 'Anchoring'], $rows['Filed']['project']);
        $this->assertNull($rows['Unfiled']['project']);
    }

    public function test_the_list_filters_by_project_id(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create();
        $filed = Document::factory()->for($workspace)->create(['project_id' => $project->id]);
        Document::factory()->for($workspace)->create();

        $response = $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents?project={$project->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $filed->id);

        // The paginator keeps the filter on its links so Load more stays scoped.
        $this->assertStringContainsString("project={$project->id}", (string) $response->json('links.first'));
    }

    public function test_the_list_filters_to_unfiled(): void
    {
        $user = $this->registerUser();
        $workspace = $user->personalWorkspace();
        $project = Project::factory()->for($workspace)->create();
        Document::factory()->for($workspace)->create(['project_id' => $project->id]);
        $unfiled = Document::factory()->for($workspace)->create();

        $this->actingAs($user)->fromWebApp()
            ->getJson('/api/v1/documents?project=unfiled')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unfiled->id);
    }

    public function test_filtering_by_a_foreign_project_id_returns_an_empty_page(): void
    {
        $user = $this->registerUser('author@example.com');
        $stranger = $this->registerUser('stranger@example.com');
        Document::factory()->for($user->personalWorkspace())->create();
        $foreign = Project::factory()->for($stranger->personalWorkspace())->create();

        // The query is already workspace-scoped, so a foreign project id matches
        // nothing — an empty page, never a leak of another workspace's docs.
        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents?project={$foreign->id}")
            ->assertOk()
            ->assertJsonCount(0, 'data');
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
