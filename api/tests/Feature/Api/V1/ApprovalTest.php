<?php

namespace Tests\Feature\Api\V1;

use App\Models\Approval;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ApprovalTest extends TestCase
{
    use RefreshDatabase;

    public function test_approve_records_current_version_and_is_idempotent_for_that_version(): void
    {
        [$author, $document, $version] = $this->readyDocumentWithVersion();

        $first = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->assertJsonPath('document_version_id', $version->id)
            ->assertJsonPath('version_label', 'v1')
            ->assertJsonPath('stale', false)
            ->assertJsonPath('user.name', $author->name);

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertOk()
            ->assertJsonPath('id', $first->json('id'))
            ->assertJsonPath('document_version_id', $version->id);

        $this->assertDatabaseCount('approvals', 1);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'approval.given')->count());
    }

    public function test_approving_after_a_new_version_lands_supersedes_the_prior_active_approval(): void
    {
        [$alice, $document, $firstVersion] = $this->readyDocumentWithVersion('alice@example.com', 'Alice');

        $oldApprovalId = $this->actingAs($alice)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->json('id');
        $bob = $this->registerUser('bob@example.com', 'Bob');
        $bobApproval = Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $firstVersion->id,
            'user_id' => $bob->id,
        ]);

        $secondVersion = $this->versionFor($document, 'v2 body', $firstVersion);
        $document->forceFill(['current_version_id' => $secondVersion->id])->save();

        $this->actingAs($alice)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->assertJsonPath('document_version_id', $secondVersion->id)
            ->assertJsonPath('version_label', 'v2')
            ->assertJsonPath('stale', false);

        $this->assertNotNull(Approval::findOrFail($oldApprovalId)->revoked_at);
        $this->assertDatabaseHas('approvals', [
            'document_id' => $document->id,
            'document_version_id' => $secondVersion->id,
            'user_id' => $alice->id,
            'revoked_at' => null,
        ]);
        $this->assertDatabaseHas('approvals', [
            'id' => $bobApproval->id,
            'revoked_at' => null,
        ]);

        $document->refresh()->loadCurrentVersionAndApprovals();
        $aliceApprovals = $document->activeApprovals
            ->where('user_id', $alice->id)
            ->values();
        $this->assertCount(1, $aliceApprovals);
        $this->assertSame($secondVersion->id, $aliceApprovals->first()->document_version_id);
        $this->assertFalse($aliceApprovals->first()->staleFor($document));
        $this->assertCount(2, $document->activeApprovals);

        $response = $this->actingAs($alice)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonCount(2, 'approvals');

        $aliceRosterEntries = collect($response->json('approvals'))
            ->filter(fn (array $approval): bool => $approval['user']['id'] === $alice->id)
            ->values();
        $this->assertCount(1, $aliceRosterEntries);
        $this->assertSame('Alice', $aliceRosterEntries->first()['user']['name']);
        $this->assertSame($secondVersion->id, $aliceRosterEntries->first()['document_version_id']);
        $this->assertFalse($aliceRosterEntries->first()['stale']);
    }

    public function test_document_roster_reports_older_active_approval_as_stale(): void
    {
        [$author, $document, $firstVersion] = $this->readyDocumentWithVersion();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated();

        $secondVersion = $this->versionFor($document, 'changed body', $firstVersion);
        $document->forceFill(['current_version_id' => $secondVersion->id])->save();

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonCount(1, 'approvals')
            ->assertJsonPath('approvals.0.document_version_id', $firstVersion->id)
            ->assertJsonPath('approvals.0.version_label', 'v1')
            ->assertJsonPath('approvals.0.stale', true)
            ->assertJsonPath('current_version.id', $secondVersion->id);
    }

    public function test_database_enforces_one_active_approval_per_reviewer_per_document(): void
    {
        [$author, $document, $firstVersion] = $this->readyDocumentWithVersion();
        $secondVersion = $this->versionFor($document, 'v2 body', $firstVersion);

        Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $firstVersion->id,
            'user_id' => $author->id,
            'revoked_at' => now(),
        ]);
        Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $secondVersion->id,
            'user_id' => $author->id,
        ]);

        $this->expectException(QueryException::class);

        Approval::create([
            'workspace_id' => $document->workspace_id,
            'document_id' => $document->id,
            'document_version_id' => $firstVersion->id,
            'user_id' => $author->id,
        ]);
    }

    public function test_revoke_sets_revoked_at_and_removes_approval_from_active_roster(): void
    {
        [$author, $document] = $this->readyDocumentWithVersion();

        $approvalId = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->json('id');

        $this->actingAs($author)->fromWebApp()
            ->deleteJson("/api/v1/approvals/{$approvalId}")
            ->assertNoContent();

        $this->assertNotNull(Approval::findOrFail($approvalId)->revoked_at);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'approval.revoked',
            'subject_id' => $approvalId,
        ]);

        $this->actingAs($author)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk()
            ->assertJsonCount(0, 'approvals');
    }

    public function test_author_updates_lifecycle_and_records_audit_event(): void
    {
        [$author, $document] = $this->readyDocumentWithVersion();

        $this->actingAs($author)->fromWebApp()
            ->patchJson("/api/v1/documents/{$document->id}", ['lifecycle_status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('lifecycle_status', 'approved')
            ->assertJsonPath('capabilities.update_lifecycle', true);

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'lifecycle_status' => 'approved',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'lifecycle.changed',
            'subject_id' => $document->id,
        ]);
    }

    /**
     * @return array{User, Document, DocumentVersion}
     */
    private function readyDocumentWithVersion(
        string $email = 'author@example.com',
        string $name = 'Reviewer',
    ): array {
        $author = $this->registerUser($email, $name);
        $document = Document::factory()
            ->for($author->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $author->id]);

        $version = $this->versionFor($document, 'v1 body');
        $document->forceFill(['current_version_id' => $version->id])->save();
        $document->setRelation('currentVersion', $version);

        return [$author, $document, $version];
    }

    private function versionFor(
        Document $document,
        string $content,
        ?DocumentVersion $parent = null,
    ): DocumentVersion {
        return DocumentVersion::factory()
            ->for($document)
            ->create([
                'content_raw' => $content,
                'content_normalized' => $content,
                'content_hash' => hash('sha256', "{$document->id}:{$content}"),
                'plain_text' => $content,
                'projection_version' => '2',
                'parent_version_id' => $parent?->id,
            ]);
    }

    private function registerUser(string $email, string $name = 'Reviewer'): User
    {
        return app(RegistrationService::class)->register(
            name: $name,
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
