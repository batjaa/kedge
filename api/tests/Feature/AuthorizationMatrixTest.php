<?php

namespace Tests\Feature;

use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Seed of the IDOR test matrix (SPEC 18.4): role x action -> expected
 * status, as one parameterized table.
 *
 * M0 only has guest vs. member on the protected routes. Later modules
 * add roles (reviewer-via-share, magic-link, MCP token, anon) and
 * actions (read/comment/suggest/resolve/share/approve/...) by extending
 * roleActionMatrix() and actAs() — never by writing one-off tests.
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
}
