<?php

namespace Tests\Feature;

use App\Enums\WorkspaceRole;
use App\Jobs\GenerateAiRunJob;
use App\Jobs\ResyncDocumentJob;
use App\Models\AiRun;
use App\Models\Approval;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Integration;
use App\Models\Share;
use App\Models\ShareParticipant;
use App\Models\Thread;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The IDOR test matrix (SPEC 18.4): role x action -> expected status, as
 * parameterized tables. An id in a URL is never an access path — every new
 * resource extends a table here rather than getting one-off tests.
 *
 * M0 seeded guest vs. member on the identity routes. M1 (#17) adds the
 * documents resource: guest / other-workspace-member / owner across read and
 * retry.
 */
class AuthorizationMatrixTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, array{string, string, string, int}>
     */
    public static function roleActionMatrix(): array
    {
        return [
            'guest cannot read current user' => ['guest', 'GET', '/api/v1/me', 401],
            'member can read current user' => ['member', 'GET', '/api/v1/me', 200],
            'guest cannot logout' => ['guest', 'POST', '/logout', 401],
            'member can logout' => ['member', 'POST', '/logout', 204],
        ];
    }

    #[DataProvider('roleActionMatrix')]
    public function test_role_action_matrix(string $role, string $method, string $uri, int $expectedStatus): void
    {
        $this->actAs($role);

        $response = $this->fromWebApp()->json($method, $uri);

        $response->assertStatus($expectedStatus);
    }

    /**
     * Documents are workspace-scoped: only members of the owning workspace reach
     * them. Read (GET) and retry (POST) share the same access rule.
     *
     * @return array<string, array{string, int}>
     */
    public static function documentRoleMatrix(): array
    {
        return [
            'guest cannot reach a document' => ['guest', 401],
            'a member of another workspace cannot reach it' => ['other', 403],
            'a member of the owning workspace can' => ['owner', 200],
        ];
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_document_read_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertStatus($expectedStatus);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_document_retry_authorization(string $role, int $expectedStatus): void
    {
        // A failed document so the owner's authorized retry lands 202 (importing),
        // not the 409 an already-ready document would return.
        Queue::fake();
        [$owner, $document] = $this->ownedDocument(failed: true);
        $this->actAsDocumentRole($role, $owner);

        // The owning member is authorized → the import is (re)queued, so 202.
        $expected = $expectedStatus === 200 ? 202 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/retry")
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_document_resync_authorization(string $role, int $expectedStatus): void
    {
        Queue::fake();
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        $expected = $expectedStatus === 200 ? 202 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/resync")
            ->assertStatus($expected);

        if ($expected === 202) {
            Queue::assertPushed(ResyncDocumentJob::class);
        }
    }

    /**
     * Share management (SPEC 10.2) is workspace-scoped like the document it hangs
     * off: list, create, and revoke all obey the same guest/other/owner rule.
     */
    #[DataProvider('documentRoleMatrix')]
    public function test_share_list_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/shares")
            ->assertStatus($expectedStatus);
    }

    /**
     * Comment threads are document-scoped. The authenticated author can create
     * and list; a member of another workspace and a guest cannot traverse ids.
     */
    #[DataProvider('documentRoleMatrix')]
    public function test_thread_create_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        $expected = $expectedStatus === 200 ? 201 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/threads", [
                'type' => 'document',
                'body' => 'Author comment',
                'idempotency_key' => "thread-{$role}",
            ])
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_thread_list_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/threads")
            ->assertStatus($expectedStatus);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_thread_reply_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $this->actAsDocumentRole($role, $owner);

        $expected = $expectedStatus === 200 ? 201 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/threads/{$thread->id}/comments", [
                'body' => 'Reply',
                'idempotency_key' => "reply-{$role}",
            ])
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_thread_status_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->patchJson("/api/v1/threads/{$thread->id}", ['status' => 'resolved'])
            ->assertStatus($expectedStatus);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_comment_fork_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $thread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Parent',
        ]);
        $reply = $thread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Reply',
        ]);
        $this->actAsDocumentRole($role, $owner);

        $expected = $expectedStatus === 200 ? 201 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/comments/{$reply->id}/fork", [
                'idempotency_key' => "fork-{$role}",
            ])
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_comment_edit_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Original',
        ]);
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->patchJson("/api/v1/comments/{$comment->id}", ['body' => 'Edited'])
            ->assertStatus($expectedStatus);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_comment_delete_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'document',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $owner->id,
            'body_md' => 'Original',
        ]);
        $this->actAsDocumentRole($role, $owner);

        $expected = $expectedStatus === 200 ? 204 : $expectedStatus;

        $this->fromWebApp()
            ->deleteJson("/api/v1/comments/{$comment->id}")
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_suggestion_transition_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $thread = Thread::create([
            'document_id' => $document->id,
            'type' => 'inline',
            'status' => 'open',
            'created_by' => $owner->id,
        ]);
        $comment = $thread->comments()->create([
            'author_id' => $owner->id,
            'type' => 'suggestion',
            'body_md' => '',
            'proposed_text' => 'Replacement',
            'suggestion_status' => 'pending',
        ]);
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->patchJson("/api/v1/comments/{$comment->id}/suggestion", ['status' => 'accepted'])
            ->assertStatus($expectedStatus);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_share_create_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsDocumentRole($role, $owner);

        // The owning member is authorized → a share is minted, so 201.
        $expected = $expectedStatus === 200 ? 201 : $expectedStatus;

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/shares")
            ->assertStatus($expected);
    }

    #[DataProvider('documentRoleMatrix')]
    public function test_share_revoke_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $share = Share::factory()->for($document)->create();
        $this->actAsDocumentRole($role, $owner);

        $this->fromWebApp()
            ->deleteJson("/api/v1/documents/{$document->id}/shares/{$share->id}")
            ->assertStatus($expectedStatus);
    }

    /**
     * Approval writes use the thread-view capability: authors, workspace
     * members, and verified reviewers for this exact document can approve.
     *
     * @return array<string, array{string, int}>
     */
    public static function approvalRoleMatrix(): array
    {
        return [
            'author can approve current version' => ['author', 201],
            'workspace member can approve current version' => ['member', 201],
            'reviewer via active share can approve scoped document' => ['reviewer', 201],
            'reviewer via a different share cannot approve this document' => ['other_reviewer', 403],
            'non-member cannot approve' => ['non_member', 403],
            'guest cannot approve' => ['guest', 401],
        ];
    }

    #[DataProvider('approvalRoleMatrix')]
    public function test_approval_create_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsReviewRole($role, $owner, $document);

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertStatus($expectedStatus);
    }

    public function test_approval_revoke_is_own_approval_only(): void
    {
        [$owner, $document] = $this->ownedDocument();
        $member = $this->workspaceMemberFor($document);
        $approval = Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $document->current_version_id,
            'user_id' => $owner->id,
        ]);

        $this->actingAs($member)->fromWebApp()
            ->deleteJson("/api/v1/approvals/{$approval->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('approvals', [
            'id' => $approval->id,
            'revoked_at' => null,
        ]);
    }

    /**
     * Lifecycle is stricter than approvals: only the document author can move
     * the editorial state.
     *
     * @return array<string, array{string, int}>
     */
    public static function lifecycleRoleMatrix(): array
    {
        return [
            'author can change lifecycle' => ['author', 200],
            'workspace member cannot change lifecycle' => ['member', 403],
            'reviewer via active share cannot change lifecycle' => ['reviewer', 403],
            'non-member cannot change lifecycle' => ['non_member', 403],
            'guest cannot change lifecycle' => ['guest', 401],
        ];
    }

    #[DataProvider('lifecycleRoleMatrix')]
    public function test_lifecycle_update_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $document] = $this->ownedDocument();
        $this->actAsReviewRole($role, $owner, $document);

        $this->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['lifecycle_status' => 'in_review'])
            ->assertStatus($expectedStatus);

        if ($expectedStatus === 200) {
            $this->assertDatabaseHas('audit_logs', [
                'action' => 'lifecycle.changed',
                'subject_id' => $document->id,
            ]);
        }
    }

    /**
     * Integration credentials (SPEC §16, ticket #23) are workspace-scoped like
     * shares. Delete resolves a row by id, so it obeys the full guest/other/owner
     * rule: a foreign integration id is never an access path.
     */
    #[DataProvider('documentRoleMatrix')]
    public function test_integration_delete_authorization(string $role, int $expectedStatus): void
    {
        [$owner, $integration] = $this->ownedIntegration();
        $this->actAsDocumentRole($role, $owner);

        // The owning member is authorized → the credential is removed, so 204.
        $expected = $expectedStatus === 200 ? 204 : $expectedStatus;

        $this->fromWebApp()
            ->deleteJson("/api/v1/integrations/{$integration->id}")
            ->assertStatus($expected);
    }

    /**
     * List and connect are scoped to the caller's own workspace, so cross-workspace
     * reach is structural — a member of another workspace can't even see this
     * workspace's connection, let alone use its id. Both still require a session.
     * (One request per test: mixing an anonymous request with actingAs in a single
     * method leaves the resolved guard stuck on the guest.)
     */
    public function test_integration_list_requires_a_session(): void
    {
        $this->ownedIntegration();

        $this->fromWebApp()->getJson('/api/v1/integrations')->assertUnauthorized();
    }

    public function test_integration_list_shows_only_the_callers_own_workspace(): void
    {
        [$owner] = $this->ownedIntegration();

        $this->actingAs($owner)->fromWebApp()
            ->getJson('/api/v1/integrations')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_a_member_of_another_workspace_never_sees_this_workspaces_integration(): void
    {
        [$owner] = $this->ownedIntegration();
        $this->actAsDocumentRole('other', $owner);

        $this->fromWebApp()
            ->getJson('/api/v1/integrations')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_integration_create_requires_a_session(): void
    {
        $this->fromWebApp()
            ->postJson('/api/v1/integrations', ['token' => 'ghp_'.str_repeat('x', 36)])
            ->assertUnauthorized();
    }

    public function test_a_member_can_connect_an_integration_in_their_own_workspace(): void
    {
        $member = app(RegistrationService::class)->register(
            name: 'Member User',
            email: 'member@example.com',
            password: 'correct-horse-battery',
        );

        $this->actingAs($member)->fromWebApp()
            ->postJson('/api/v1/integrations', ['token' => 'ghp_'.str_repeat('x', 36)])
            ->assertStatus(201);
    }

    /**
     * The ai-run action column (SPEC §18.4, M4 #130). Generation is a MEMBER
     * capability, not a reviewer one: a magic-link reviewer may read, comment,
     * suggest, and approve one shared document, but spending the workspace's
     * Anthropic key is not part of that grant.
     *
     * @return array<string, array{string, int}>
     */
    public static function aiRunRoleMatrix(): array
    {
        return [
            'author can request a digest' => ['author', 202],
            'workspace member can request a digest' => ['member', 202],
            'reviewer via active share cannot request a digest' => ['reviewer', 403],
            'reviewer via a different share cannot request a digest' => ['other_reviewer', 403],
            'non-member cannot request a digest' => ['non_member', 403],
            'guest cannot request a digest' => ['guest', 401],
        ];
    }

    #[DataProvider('aiRunRoleMatrix')]
    public function test_ai_digest_create_authorization(string $role, int $expectedStatus): void
    {
        Queue::fake();
        config(['kedge.ai.enabled' => true]);
        [$owner, $document] = $this->ownedDocument();
        $this->actAsReviewRole($role, $owner, $document);

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/ai/digest")
            ->assertStatus($expectedStatus);

        if ($expectedStatus === 202) {
            Queue::assertPushed(GenerateAiRunJob::class);
        } else {
            Queue::assertNotPushed(GenerateAiRunJob::class);
            $this->assertDatabaseCount('ai_runs', 0);
        }
    }

    /**
     * Reading a run — the poll target — obeys the same workspace scope: an
     * ai-run id in a URL is never an access path.
     *
     * @return array<string, array{string, int}>
     */
    public static function aiRunReadRoleMatrix(): array
    {
        return [
            'author can poll their run' => ['author', 200],
            'workspace member can poll the run' => ['member', 200],
            'reviewer via active share cannot poll it' => ['reviewer', 403],
            'reviewer via a different share cannot poll it' => ['other_reviewer', 403],
            'non-member cannot poll it' => ['non_member', 403],
            'guest cannot poll it' => ['guest', 401],
        ];
    }

    #[DataProvider('aiRunReadRoleMatrix')]
    public function test_ai_run_read_authorization(string $role, int $expectedStatus): void
    {
        config(['kedge.ai.enabled' => true]);
        [$owner, $document] = $this->ownedDocument();
        $run = AiRun::factory()->for($document)->create([
            'workspace_id' => $document->workspace_id,
            'created_by' => $owner->id,
        ]);
        $this->actAsReviewRole($role, $owner, $document);

        $this->fromWebApp()
            ->getJson("/api/v1/ai-runs/{$run->id}")
            ->assertStatus($expectedStatus);
    }

    /**
     * The core share-visitor IDOR row (SPEC 10.2, ticket #24): the token grants
     * exactly one document and no traversal — not the document's own API, not
     * another token, not a session.
     */
    public function test_share_visitor_is_scoped_to_exactly_that_document(): void
    {
        [$owner, $document] = $this->ownedDocument();
        $token = Str::random(48);
        Share::factory()->for($document)->withToken($token)->create();

        // With the token (no cookie), the visitor reads exactly that document.
        $this->getJson("/api/v1/shared/{$token}")->assertOk();

        // The token is not a session: the document's authenticated API is closed.
        $this->getJson("/api/v1/documents/{$document->id}")->assertUnauthorized();

        // And it reaches no other share — another token is just "gone".
        $this->getJson('/api/v1/shared/'.Str::random(48))->assertStatus(410);
    }

    /**
     * Put the request in the given role. Extend per new role.
     */
    private function actAs(string $role): void
    {
        match ($role) {
            'guest' => null,
            'member' => $this->actingAs(app(RegistrationService::class)->register(
                name: 'Member User',
                email: 'member@example.com',
                password: 'correct-horse-battery',
            )),
        };
    }

    /**
     * @return array{User, Document}
     */
    private function ownedDocument(bool $failed = false): array
    {
        $owner = app(RegistrationService::class)->register(
            name: 'Owner User',
            email: 'owner@example.com',
            password: 'correct-horse-battery',
        );

        $factory = Document::factory()->for($owner->personalWorkspace(), 'workspace');
        $document = ($failed ? $factory->failed() : $factory->ready())
            ->create(['created_by' => $owner->id]);

        if (! $failed) {
            $content = "# Auth Matrix\n\nText to anchor.";
            $version = DocumentVersion::factory()
                ->for($document)
                ->create([
                    'content_raw' => $content,
                    'content_normalized' => $content,
                    'content_hash' => hash('sha256', $content),
                    'plain_text' => 'Text to anchor.',
                    'projection_version' => '2',
                ]);

            $document->forceFill(['current_version_id' => $version->id])->save();
            $document->setRelation('currentVersion', $version);
        }

        return [$owner, $document];
    }

    /**
     * @return array{User, Integration}
     */
    private function ownedIntegration(): array
    {
        $owner = app(RegistrationService::class)->register(
            name: 'Owner User',
            email: 'owner@example.com',
            password: 'correct-horse-battery',
        );

        $integration = Integration::factory()
            ->for($owner->personalWorkspace())
            ->create();

        return [$owner, $integration];
    }

    private function actAsDocumentRole(string $role, User $owner): void
    {
        match ($role) {
            'guest' => null,
            'owner' => $this->actingAs($owner),
            'other' => $this->actingAs(app(RegistrationService::class)->register(
                name: 'Other User',
                email: 'other@example.com',
                password: 'correct-horse-battery',
            )),
        };
    }

    private function actAsReviewRole(string $role, User $owner, Document $document): void
    {
        $user = match ($role) {
            'guest' => null,
            'author' => $owner,
            'member' => $this->workspaceMemberFor($document),
            'reviewer' => $this->verifiedReviewerFor($document, 'reviewer@example.com'),
            'other_reviewer' => $this->verifiedReviewerFor(Document::factory()->ready()->create(), 'other-reviewer@example.com'),
            'non_member' => app(RegistrationService::class)->register(
                name: 'Non Member',
                email: 'non-member@example.com',
                password: 'correct-horse-battery',
            ),
        };

        if ($user instanceof User) {
            $this->actingAs($user);
        }
    }

    private function workspaceMemberFor(Document $document): User
    {
        $member = User::factory()->create([
            'name' => 'Workspace Member',
            'email' => 'workspace-member@example.com',
        ]);
        $member->workspaces()->attach($document->workspace_id, ['role' => WorkspaceRole::Member->value]);

        return $member;
    }

    private function verifiedReviewerFor(Document $document, string $email): User
    {
        $reviewer = User::factory()->create([
            'name' => 'Share Reviewer',
            'email' => $email,
            'password' => null,
        ]);
        $share = Share::factory()->for($document)->create();
        ShareParticipant::create([
            'share_id' => $share->id,
            'user_id' => $reviewer->id,
            'verified_at' => now(),
        ]);

        return $reviewer;
    }
}
