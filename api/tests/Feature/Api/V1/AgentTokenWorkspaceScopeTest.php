<?php

namespace Tests\Feature\Api\V1;

use App\Enums\WorkspaceRole;
use App\Models\Document;
use App\Models\Share;
use App\Models\ShareParticipant;
use App\Models\Thread;
use App\Models\User;
use App\Models\Workspace;
use App\Policies\Concerns\AuthorizesWorkspaceMembership;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

/**
 * G2 — workspace scoping lives in the shared Policy membership trait, not in
 * each tool (m4-ai-agents eng review §2).
 *
 * The scenario that matters is a member of TWO workspaces whose agent token is
 * scoped to one of them: the human may reach both, the agent may reach only the
 * one its credential names. Because the check sits in
 * {@see AuthorizesWorkspaceMembership}, every Policy —
 * including the ones M4's MCP tools (#135) will resolve, and every Policy
 * written after them — inherits it without its author doing anything.
 *
 * These assert at the Gate, which is the seam MCP tools resolve through; the
 * REST surface refuses agent tokens outright (see AgentTokenRestRejectionTest).
 */
class AgentTokenWorkspaceScopeTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Workspace $home;

    private Workspace $other;

    private Document $homeDocument;

    private Document $otherDocument;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = app(RegistrationService::class)->register(
            name: 'Agent Operator',
            email: 'operator@example.com',
            password: 'correct-horse-battery',
        );
        $this->home = $this->user->personalWorkspace();

        // A second workspace the human genuinely belongs to — the token must not
        // inherit that reach.
        $this->other = Workspace::create(['name' => 'Other Team', 'slug' => 'other-team']);
        $this->user->workspaces()->attach($this->other->id, ['role' => WorkspaceRole::Member->value]);

        $this->homeDocument = $this->documentIn($this->home);
        $this->otherDocument = $this->documentIn($this->other);
    }

    private function documentIn(Workspace $workspace): Document
    {
        return Document::factory()
            ->for($workspace, 'workspace')
            ->ready()
            ->create(['created_by' => $this->user->id]);
    }

    /** The same user, acting through a token scoped to one workspace. */
    private function agentScopedTo(Workspace $workspace): User
    {
        $issued = $this->user->createToken('Claude Code', ['workspace:'.$workspace->id]);

        return $this->user->fresh()->withAccessToken($issued->accessToken);
    }

    public function test_a_human_session_reaches_both_workspaces(): void
    {
        $human = $this->user;

        $this->assertTrue(Gate::forUser($human)->allows('view', $this->homeDocument));
        $this->assertTrue(Gate::forUser($human)->allows('view', $this->otherDocument));
    }

    public function test_a_token_reads_only_the_workspace_it_is_scoped_to(): void
    {
        $agent = $this->agentScopedTo($this->home);

        $this->assertTrue(Gate::forUser($agent)->allows('view', $this->homeDocument));
        $this->assertFalse(
            Gate::forUser($agent)->allows('view', $this->otherDocument),
            'A cross-workspace read must be denied through the shared Policy trait',
        );
    }

    public function test_a_token_writes_only_in_the_workspace_it_is_scoped_to(): void
    {
        $agent = $this->agentScopedTo($this->home);

        $this->assertTrue(Gate::forUser($agent)->allows('create', [Thread::class, $this->homeDocument]));
        $this->assertFalse(
            Gate::forUser($agent)->allows('create', [Thread::class, $this->otherDocument]),
            'A cross-workspace write must be denied through the shared Policy trait',
        );
    }

    public function test_a_token_cannot_ride_its_owners_authorship_across_workspaces(): void
    {
        $agent = $this->agentScopedTo($this->home);
        $thread = Thread::create([
            'document_id' => $this->otherDocument->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $this->user->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $this->user->id,
            'body_md' => 'Mine, but in another workspace',
        ]);

        $this->assertFalse(Gate::forUser($agent)->allows('triage', $thread));
        $this->assertFalse(Gate::forUser($agent)->allows('updateComment', $comment));
        $this->assertFalse(Gate::forUser($agent)->allows('updateLifecycle', $this->otherDocument));
    }

    public function test_a_token_cannot_ride_its_owners_share_reviewership_across_workspaces(): void
    {
        $foreignWorkspace = Workspace::create(['name' => 'Third Party', 'slug' => 'third-party']);
        $sharedDocument = Document::factory()->for($foreignWorkspace, 'workspace')->ready()->create();
        $share = Share::factory()->for($sharedDocument)->create();
        ShareParticipant::create([
            'share_id' => $share->id,
            'user_id' => $this->user->id,
            'verified_at' => now(),
        ]);

        // The human, as a verified reviewer, may read that document's threads.
        $this->assertTrue(Gate::forUser($this->user)->allows('viewAny', [Thread::class, $sharedDocument]));

        // Their agent, scoped to their own workspace, may not.
        $agent = $this->agentScopedTo($this->home);
        $this->assertFalse(Gate::forUser($agent)->allows('viewAny', [Thread::class, $sharedDocument]));
    }

    public function test_a_token_scoped_to_a_foreign_workspace_reaches_nothing_of_its_owners(): void
    {
        $agent = $this->agentScopedTo($this->other);

        $this->assertFalse(Gate::forUser($agent)->allows('view', $this->homeDocument));
        $this->assertFalse(
            Gate::forUser($agent)->allows('viewAny', Document::class),
            'The personal-workspace guard is scoped too — no listing outside the token',
        );
    }
}
