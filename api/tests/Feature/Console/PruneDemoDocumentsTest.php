<?php

namespace Tests\Feature\Console;

use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Share;
use App\Services\SystemWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The scheduled demo-doc reaper (SPEC §10.3, testing decision 1, #25), exercised
 * under frozen time. A demo doc's TTL is honored to the hour: past `expires_at`
 * gets deleted with its versions and shares; a still-live one and a claimed one
 * (no TTL) survive. Nothing here inspects the scheduler — only the command's
 * observable effect on the database.
 */
class PruneDemoDocumentsTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_prunes_expired_demo_docs_with_their_versions_and_shares(): void
    {
        // A demo doc created 49h ago (TTL is 48h), so it is now expired.
        $expired = $this->travelTo(now()->subHours(49), fn () => $this->demoDocumentWithVersionAndShare());

        $this->artisan('kedge:prune-demo-docs')
            ->expectsOutputToContain('Pruned 1')
            ->assertSuccessful();

        $this->assertDatabaseMissing('documents', ['id' => $expired->id]);
        // Versions and shares ride out on the cascade.
        $this->assertDatabaseCount('document_versions', 0);
        $this->assertDatabaseCount('shares', 0);
    }

    public function test_it_leaves_a_demo_doc_that_has_not_yet_expired(): void
    {
        // Created 1h ago — well inside the 48h TTL.
        $live = $this->travelTo(now()->subHour(), fn () => $this->demoDocumentWithVersionAndShare());

        $this->artisan('kedge:prune-demo-docs')
            ->expectsOutputToContain('No expired demo documents')
            ->assertSuccessful();

        $this->assertDatabaseHas('documents', ['id' => $live->id]);
    }

    public function test_it_never_touches_a_claimed_or_ordinary_doc(): void
    {
        // A claimed doc: it left the system workspace and its TTL was cleared, so
        // even long after its old expiry it is untouchable.
        $claimed = Document::factory()->ready()->create(['expires_at' => null]);

        $this->artisan('kedge:prune-demo-docs')->assertSuccessful();

        $this->assertDatabaseHas('documents', ['id' => $claimed->id]);
    }

    public function test_it_is_a_no_op_when_no_system_workspace_exists(): void
    {
        // A self-hosted instance never created the system workspace.
        $this->assertNull(app(SystemWorkspace::class)->find());

        $this->artisan('kedge:prune-demo-docs')
            ->expectsOutputToContain('No system workspace')
            ->assertSuccessful();
    }

    // ---- helpers ------------------------------------------------------------

    private function demoDocumentWithVersionAndShare(): Document
    {
        $document = Document::factory()->demo()->ready()->create();
        DocumentVersion::factory()->for($document)->create();
        Share::factory()->for($document)->create();

        return $document;
    }
}
