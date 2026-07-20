<?php

namespace Tests\Feature\Api\V1;

use App\Enums\VersionKind;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DocumentVersionTest extends TestCase
{
    use RefreshDatabase;

    public function test_member_lists_document_versions_in_lineage_order(): void
    {
        [$member, $document, $versions] = $this->readyDocumentWithVersions();

        $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/versions")
            ->assertOk()
            ->assertJsonPath('data.0.id', $versions[0]->id)
            ->assertJsonPath('data.0.ordinal', 1)
            ->assertJsonPath('data.0.kind', 'mainline')
            ->assertJsonPath('data.0.parent_version_id', null)
            ->assertJsonPath('data.1.id', $versions[1]->id)
            ->assertJsonPath('data.1.ordinal', 2)
            ->assertJsonPath('data.1.kind', 'mainline')
            ->assertJsonPath('data.1.parent_version_id', $versions[0]->id)
            ->assertJsonPath('data.2.id', $versions[2]->id)
            ->assertJsonPath('data.2.ordinal', 3)
            ->assertJsonPath('data.2.kind', 'mainline')
            ->assertJsonPath('data.2.parent_version_id', $versions[1]->id);
    }

    public function test_member_reads_single_document_version_render_payload(): void
    {
        [$member, $document, $versions] = $this->readyDocumentWithVersions();

        $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/versions/{$versions[1]->id}")
            ->assertOk()
            ->assertJsonPath('id', $versions[1]->id)
            ->assertJsonPath('ordinal', 2)
            ->assertJsonPath('content', 'v2')
            ->assertJsonPath('plain_text', 'v2')
            ->assertJsonPath('projection_version', '2')
            ->assertJsonPath('mdx_ok', null)
            ->assertJsonPath('source_version', null);
    }

    public function test_single_version_read_is_view_authorized(): void
    {
        [, $document, $versions] = $this->readyDocumentWithVersions();
        $other = $this->registerUser('other@example.com');

        $this->actingAs($other)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/versions/{$versions[0]->id}")
            ->assertForbidden();
    }

    public function test_single_version_read_404s_foreign_version(): void
    {
        [$member, $document] = $this->readyDocumentWithVersions();
        $foreignDocument = Document::factory()
            ->for($member->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $member->id]);
        $foreignVersion = $this->versionFor($foreignDocument, 'foreign');

        $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/versions/{$foreignVersion->id}")
            ->assertNotFound();
    }

    public function test_ordinals_are_independent_per_document_and_document_show_exposes_current_ordinal(): void
    {
        [$member, $firstDocument, $firstVersions] = $this->readyDocumentWithVersions();
        $secondDocument = Document::factory()
            ->for($member->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $member->id]);
        $secondFirst = $this->versionFor($secondDocument, 'second-v1');
        $secondSecond = $this->versionFor($secondDocument, 'second-v2', $secondFirst);
        $secondDocument->forceFill(['current_version_id' => $secondSecond->id])->save();

        $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$firstDocument->id}")
            ->assertOk()
            ->assertJsonPath('current_version.id', $firstVersions[2]->id)
            ->assertJsonPath('current_version.ordinal', 3);

        $this->actingAs($member)->fromWebApp()
            ->getJson("/api/v1/documents/{$secondDocument->id}/versions")
            ->assertOk()
            ->assertJsonPath('data.0.id', $secondFirst->id)
            ->assertJsonPath('data.0.ordinal', 1)
            ->assertJsonPath('data.1.id', $secondSecond->id)
            ->assertJsonPath('data.1.ordinal', 2);
    }

    public function test_non_member_cannot_list_document_versions(): void
    {
        [, $document] = $this->readyDocumentWithVersions();
        $other = $this->registerUser('other@example.com');

        $this->actingAs($other)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/versions")
            ->assertForbidden();
    }

    public function test_lineage_migration_backfills_existing_document_versions(): void
    {
        $migration = $this->lineageMigration();
        $migration->down();

        $this->assertFalse(Schema::hasColumn('document_versions', 'kind'));
        $this->assertFalse(Schema::hasColumn('document_versions', 'parent_version_id'));

        $now = now();
        $workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Specs',
            'slug' => 'specs',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $documentId = DB::table('documents')->insertGetId([
            'workspace_id' => $workspaceId,
            'source_type' => 'raw_url',
            'source_url' => 'https://example.test/spec.md',
            'title' => 'Spec',
            'format' => 'md',
            'status' => 'ready',
            'last_sync_status' => 'ok',
            'lifecycle_status' => 'draft',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $otherDocumentId = DB::table('documents')->insertGetId([
            'workspace_id' => $workspaceId,
            'source_type' => 'raw_url',
            'source_url' => 'https://example.test/other.md',
            'title' => 'Other Spec',
            'format' => 'md',
            'status' => 'ready',
            'last_sync_status' => 'ok',
            'lifecycle_status' => 'draft',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $versionIds = [
            $this->insertLegacyVersion($documentId, 'v1'),
            $this->insertLegacyVersion($documentId, 'v2'),
            $this->insertLegacyVersion($documentId, 'v3'),
        ];
        $otherVersionId = $this->insertLegacyVersion($otherDocumentId, 'other-v1');

        $migration->up();

        $versions = DB::table('document_versions')
            ->where('document_id', $documentId)
            ->orderBy('id')
            ->get(['id', 'kind', 'parent_version_id'])
            ->map(fn (object $version): array => [
                'id' => $version->id,
                'kind' => $version->kind,
                'parent_version_id' => $version->parent_version_id,
            ])
            ->all();

        $this->assertSame([
            ['id' => $versionIds[0], 'kind' => 'mainline', 'parent_version_id' => null],
            ['id' => $versionIds[1], 'kind' => 'mainline', 'parent_version_id' => $versionIds[0]],
            ['id' => $versionIds[2], 'kind' => 'mainline', 'parent_version_id' => $versionIds[1]],
        ], $versions);

        $this->assertDatabaseHas('document_versions', [
            'id' => $otherVersionId,
            'kind' => 'mainline',
            'parent_version_id' => null,
        ]);
    }

    /**
     * @return array{User, Document, array<int, DocumentVersion>}
     */
    private function readyDocumentWithVersions(): array
    {
        $member = $this->registerUser('member@example.com');
        $document = Document::factory()
            ->for($member->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $member->id]);

        $first = $this->versionFor($document, 'v1');
        $second = $this->versionFor($document, 'v2', $first);
        $third = $this->versionFor($document, 'v3', $second);

        $document->forceFill(['current_version_id' => $third->id])->save();

        return [$member, $document, [$first, $second, $third]];
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
                'content_hash' => hash('sha256', $content),
                'plain_text' => $content,
                'projection_version' => '2',
                'kind' => VersionKind::Mainline,
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

    private function insertLegacyVersion(int $documentId, string $content): int
    {
        return DB::table('document_versions')->insertGetId([
            'document_id' => $documentId,
            'content_raw' => $content,
            'content_normalized' => $content,
            'plain_text' => $content,
            'projection_version' => '2',
            'content_hash' => hash('sha256', $content),
            'source_version' => $content,
            'synced_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function lineageMigration(): object
    {
        return include database_path('migrations/2026_07_20_173901_add_lineage_to_document_versions_table.php');
    }
}
