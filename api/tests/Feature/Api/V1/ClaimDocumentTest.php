<?php

namespace Tests\Feature\Api\V1;

use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Share;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Claiming a demo doc into a real workspace over the API HTTP seam (SPEC §10.3,
 * testing decision 1, #25) — the "trying converts to owning" half of the wedge.
 *
 * Asserts observable outcomes: the doc moves workspace, gains a creator, loses its
 * TTL; only demo docs are claimable (a normal doc and an already-claimed one both
 * 403 through the Policy); the anonymous share the visitor already holds keeps
 * working; and the whole thing 404s when self-hosted.
 */
class ClaimDocumentTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_signed_in_user_claims_a_demo_doc_into_their_workspace(): void
    {
        $user = $this->registerUser();
        $document = $this->demoDocument();
        $originalWorkspace = $document->workspace_id;

        $response = $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim");

        $response->assertOk()
            ->assertJsonPath('id', $document->id)
            ->assertJsonPath('title', $document->title)
            ->assertJsonPath('current_version.content', "# Claim me\n\nBody.\n");

        $document->refresh();
        $this->assertSame($user->personalWorkspace()->id, $document->workspace_id);
        $this->assertNotSame($originalWorkspace, $document->workspace_id);
        $this->assertSame($user->id, $document->created_by);
        $this->assertNull($document->expires_at, 'Claiming clears the demo TTL.');
        $this->assertFalse($document->isDemo());

        // The doc is now reachable through the owner's authenticated API.
        $this->actingAs($user)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}")
            ->assertOk();
    }

    public function test_claim_records_a_demo_claimed_audit_event(): void
    {
        $user = $this->registerUser();
        $document = $this->demoDocument();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'demo.claimed',
            'workspace_id' => $user->personalWorkspace()->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_the_visitors_existing_share_still_reads_the_now_owned_doc(): void
    {
        $user = $this->registerUser();
        $document = $this->demoDocument();

        $token = Str::random(48);
        Share::factory()->for($document)->withToken($token)->create();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertOk();

        // The link the anonymous visitor already had keeps working — now the doc
        // is no longer a demo, so it is no longer advertised as claimable.
        $this->getJson("/api/v1/shared/{$token}")
            ->assertOk()
            ->assertJsonPath('claimable', false);
    }

    public function test_a_normal_document_is_not_claimable(): void
    {
        $owner = $this->registerUser();
        $document = Document::factory()
            ->for($owner->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $owner->id]);

        // Even the owner can't "claim" a doc that was never a demo.
        $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertForbidden();
    }

    public function test_an_already_claimed_demo_doc_cannot_be_claimed_again(): void
    {
        // A demo doc that someone already claimed: it left the system workspace and
        // its TTL was cleared, so it is no longer a demo doc and a second claimant
        // is refused — first come, first owned.
        $firstOwner = $this->registerUser('first@example.com');
        $document = $this->demoDocument();
        $document->forceFill([
            'workspace_id' => $firstOwner->personalWorkspace()->id,
            'created_by' => $firstOwner->id,
            'expires_at' => null,
        ])->save();

        $secondClaimant = $this->registerUser('second@example.com');

        $this->actingAs($secondClaimant)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertForbidden();

        $this->assertSame($firstOwner->personalWorkspace()->id, $document->fresh()->workspace_id);
    }

    public function test_a_guest_cannot_claim(): void
    {
        $document = $this->demoDocument();

        $this->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertUnauthorized();
    }

    public function test_self_hosted_removes_the_claim_endpoint(): void
    {
        config(['kedge.self_hosted' => true]);
        $user = $this->registerUser();
        $document = $this->demoDocument();

        $this->actingAs($user)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/claim")
            ->assertNotFound();
    }

    // ---- helpers ------------------------------------------------------------

    private function registerUser(string $email = 'claimer@example.com'): User
    {
        return app(RegistrationService::class)->register(
            name: 'Claimer',
            email: $email,
            password: 'correct-horse-battery',
        );
    }

    /**
     * A ready demo doc in the system workspace, with a rendered version.
     */
    private function demoDocument(): Document
    {
        $content = "# Claim me\n\nBody.\n";

        $document = Document::factory()
            ->demo()
            ->ready()
            ->has(
                DocumentVersion::factory()->state([
                    'content_normalized' => $content,
                    'content_raw' => $content,
                    'content_hash' => hash('sha256', $content),
                ]),
                'versions',
            )
            ->create(['title' => 'Demo Doc']);

        $document->forceFill(['current_version_id' => $document->versions()->sole()->id])->save();

        return $document->fresh();
    }
}
