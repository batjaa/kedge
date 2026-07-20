<?php

namespace Tests\Feature\Api\V1;

use App\Models\Approval;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\RegistrationService;
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
            ->assertJsonPath('version_label', "v{$version->id}")
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

    public function test_approving_after_a_new_version_lands_creates_a_reapproval_on_the_new_version(): void
    {
        [$author, $document, $firstVersion] = $this->readyDocumentWithVersion();

        $oldApprovalId = $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->json('id');

        $secondVersion = $this->versionFor($document, 'v2 body', $firstVersion);
        $document->forceFill(['current_version_id' => $secondVersion->id])->save();

        $this->actingAs($author)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/approvals")
            ->assertCreated()
            ->assertJsonPath('document_version_id', $secondVersion->id)
            ->assertJsonPath('version_label', "v{$secondVersion->id}")
            ->assertJsonPath('stale', false);

        $this->assertDatabaseHas('approvals', [
            'id' => $oldApprovalId,
            'document_version_id' => $firstVersion->id,
            'revoked_at' => null,
        ]);
        $this->assertDatabaseHas('approvals', [
            'document_id' => $document->id,
            'document_version_id' => $secondVersion->id,
            'user_id' => $author->id,
            'revoked_at' => null,
        ]);
        $this->assertDatabaseCount('approvals', 2);
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
            ->assertJsonPath('approvals.0.version_label', "v{$firstVersion->id}")
            ->assertJsonPath('approvals.0.stale', true)
            ->assertJsonPath('current_version.id', $secondVersion->id);
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
    private function readyDocumentWithVersion(): array
    {
        $author = $this->registerUser('author@example.com');
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

    private function registerUser(string $email): User
    {
        return app(RegistrationService::class)->register(
            name: 'Reviewer',
            email: $email,
            password: 'correct-horse-battery',
        );
    }
}
