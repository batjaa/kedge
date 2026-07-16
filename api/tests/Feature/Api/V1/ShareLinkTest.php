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
 * Share links over the API HTTP seam (SPEC 10.2, testing decision 1): create /
 * list / revoke behind Policies, and the public read surface with its
 * distinguishable "gone" answers. Asserts observable API state only — the token
 * hashing is verified through what the database holds, never through internals.
 */
class ShareLinkTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_creates_a_share_link_returning_the_url_once(): void
    {
        [$owner, $document] = $this->ownedDocument();

        $response = $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/shares");

        $response->assertCreated()
            ->assertJsonPath('visibility', 'link')
            ->assertJsonPath('status', 'active')
            ->assertJsonPath('expires_at', null);

        $url = $response->json('url');
        $this->assertNotNull($url, 'The create response must carry the one-time URL.');
        $this->assertStringContainsString('/shared/', $url);

        $token = Str::afterLast($url, '/shared/');
        $this->assertGreaterThanOrEqual(32, strlen($token), 'Token must be at least 32 chars.');

        // The plaintext is never stored — only its sha256 digest.
        $this->assertDatabaseCount('shares', 1);
        $this->assertDatabaseHas('shares', ['token_hash' => hash('sha256', $token)]);
        $this->assertDatabaseMissing('shares', ['token_hash' => $token]);
        $this->assertSame($token, Str::afterLast($url, '/shared/'));
    }

    public function test_public_reads_a_shared_document_by_token_with_noindex(): void
    {
        [, $document] = $this->ownedDocument(content: "# Shared Spec\n\nRead me anonymously.\n");
        $token = $this->issueToken($document);

        // No actingAs, no cookie — the token alone is the capability.
        $response = $this->getJson("/api/v1/shared/{$token}");

        $response->assertOk()
            ->assertJsonPath('title', $document->title)
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('current_version.content', "# Shared Spec\n\nRead me anonymously.\n");

        // A "private link" must stay out of search indexes.
        $this->assertStringContainsString('noindex', $response->headers->get('X-Robots-Tag'));

        // The internal id is never exposed on the public surface.
        $response->assertJsonMissingPath('id');
    }

    public function test_signed_in_share_reader_does_not_receive_projection_substrate(): void
    {
        [$owner, $document] = $this->ownedDocument(content: "# Shared Spec\n\nRead me anonymously.\n");
        $document->currentVersion->forceFill([
            'plain_text' => 'Shared Spec'.PHP_EOL.PHP_EOL.'Read me anonymously.',
            'projection_version' => '2',
        ])->save();
        $token = $this->issueToken($document);

        $this->actingAs($owner)->fromWebApp()
            ->getJson("/api/v1/shared/{$token}")
            ->assertOk()
            ->assertJsonMissingPath('current_version.plain_text')
            ->assertJsonMissingPath('current_version.projection_version');
    }

    public function test_revoked_share_reads_as_gone(): void
    {
        [$owner, $document] = $this->ownedDocument();
        $token = $this->issueToken($document);

        $share = Share::sole();
        $this->actingAs($owner)->fromWebApp()
            ->deleteJson("/api/v1/documents/{$document->id}/shares/{$share->id}")
            ->assertOk()
            ->assertJsonPath('status', 'revoked');

        $this->getJson("/api/v1/shared/{$token}")
            ->assertStatus(410)
            ->assertJsonPath('error', 'share_gone')
            ->assertJsonPath('reason', 'revoked');
    }

    public function test_expired_share_reads_as_gone(): void
    {
        [, $document] = $this->ownedDocument();
        $token = Str::random(48);
        Share::factory()->for($document)->withToken($token)->expired()->create();

        $this->getJson("/api/v1/shared/{$token}")
            ->assertStatus(410)
            ->assertJsonPath('reason', 'expired');
    }

    public function test_unknown_token_reads_as_gone_not_404(): void
    {
        // A never-issued token is indistinguishable from a typo: same 410, and it
        // never reveals whether a token once existed.
        $this->getJson('/api/v1/shared/'.Str::random(48))
            ->assertStatus(410)
            ->assertJsonPath('reason', 'unknown');
    }

    public function test_owner_revokes_a_share(): void
    {
        [$owner, $document] = $this->ownedDocument();
        $share = Share::factory()->for($document)->create();

        $this->actingAs($owner)->fromWebApp()
            ->deleteJson("/api/v1/documents/{$document->id}/shares/{$share->id}")
            ->assertOk()
            ->assertJsonPath('status', 'revoked');

        $this->assertNotNull($share->fresh()->revoked_at);
    }

    public function test_listing_shares_never_exposes_the_token_or_url(): void
    {
        [$owner, $document] = $this->ownedDocument();
        Share::factory()->count(2)->for($document)->create();

        $response = $this->actingAs($owner)->fromWebApp()
            ->getJson("/api/v1/documents/{$document->id}/shares");

        // Single resources are flat ($wrap = null), but the collection keeps the
        // conventional `data` envelope.
        $response->assertOk()->assertJsonCount(2, 'data');

        // The list can only ever show state, never a working link.
        $encoded = json_encode($response->json());
        $this->assertStringNotContainsString('"url"', $encoded);
        $this->assertStringNotContainsString('token', $encoded);
    }

    public function test_shares_are_scoped_to_their_document(): void
    {
        // A share belongs to exactly one document: revoking it via a *different*
        // document's route 404s (scoped route-model binding), never touching it.
        [$owner, $documentA] = $this->ownedDocument();
        $documentB = Document::factory()
            ->for($owner->personalWorkspace(), 'workspace')
            ->ready()
            ->create(['created_by' => $owner->id]);

        $share = Share::factory()->for($documentA)->create();

        $this->actingAs($owner)->fromWebApp()
            ->deleteJson("/api/v1/documents/{$documentB->id}/shares/{$share->id}")
            ->assertNotFound();

        $this->assertNull($share->fresh()->revoked_at);
    }

    public function test_rejects_a_non_link_visibility(): void
    {
        [$owner, $document] = $this->ownedDocument();

        $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/shares", ['visibility' => 'workspace'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('visibility');

        $this->assertDatabaseCount('shares', 0);
    }

    public function test_expiry_in_days_sets_a_future_expiry(): void
    {
        [$owner, $document] = $this->ownedDocument();

        $response = $this->actingAs($owner)->fromWebApp()
            ->postJson("/api/v1/documents/{$document->id}/shares", ['expires_in_days' => 7]);

        $response->assertCreated();
        $this->assertNotNull($response->json('expires_at'));

        $share = Share::sole();
        $this->assertTrue($share->expires_at->isFuture());
        $this->assertTrue($share->expires_at->between(now()->addDays(6), now()->addDays(8)));
    }

    public function test_public_read_is_rate_limited_per_ip(): void
    {
        [, $document] = $this->ownedDocument();
        $token = $this->issueToken($document);

        // The per-IP bucket is 60/min; the 61st read trips 429.
        for ($i = 0; $i < 60; $i++) {
            $this->getJson("/api/v1/shared/{$token}")->assertOk();
        }

        $this->getJson("/api/v1/shared/{$token}")->assertTooManyRequests();
    }

    // ---- helpers ------------------------------------------------------------

    /**
     * An owner with a ready document in their personal workspace.
     *
     * @return array{User, Document}
     */
    private function ownedDocument(string $content = "# Doc\n\nBody.\n"): array
    {
        $owner = app(RegistrationService::class)->register(
            name: 'Owner User',
            email: 'owner@example.com',
            password: 'correct-horse-battery',
        );

        $document = Document::factory()
            ->for($owner->personalWorkspace(), 'workspace')
            ->ready()
            ->has(
                DocumentVersion::factory()->state([
                    'content_normalized' => $content,
                    'content_raw' => $content,
                    'content_hash' => hash('sha256', $content),
                ]),
                'versions',
            )
            ->create(['created_by' => $owner->id]);

        $document->forceFill(['current_version_id' => $document->versions()->sole()->id])->save();

        return [$owner, $document->fresh()];
    }

    /**
     * Mint a share through the service and return its plaintext token.
     */
    private function issueToken(Document $document): string
    {
        $token = Str::random(48);
        Share::factory()->for($document)->withToken($token)->create();

        return $token;
    }
}
