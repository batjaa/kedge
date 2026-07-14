<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
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

        return [$owner, $document];
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
}
