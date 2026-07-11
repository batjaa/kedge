<?php

namespace Tests\Feature\Api\V1;

use App\Models\User;
use App\Models\Workspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * External behavior of GET /api/v1/me: the who-am-I contract the web app
 * (and later the BFF route handlers) build on.
 */
class CurrentUserTest extends TestCase
{
    use RefreshDatabase;

    public function test_me_returns_the_user_and_their_personal_workspace(): void
    {
        $this->postJson('/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ])->assertCreated();

        $user = User::firstWhere('email', 'ada@example.com');
        $workspace = Workspace::sole();

        $response = $this->fromWebApp()->getJson('/api/v1/me');

        $response
            ->assertOk()
            ->assertExactJson([
                'user' => [
                    'id' => $user->id,
                    'name' => 'Ada Lovelace',
                    'email' => 'ada@example.com',
                    'avatar_url' => null,
                ],
                'workspace' => [
                    'id' => $workspace->id,
                    'name' => $workspace->name,
                    'slug' => $workspace->slug,
                ],
            ]);
    }

    public function test_me_returns_401_json_for_guests(): void
    {
        $response = $this->fromWebApp()->getJson('/api/v1/me');

        $response
            ->assertUnauthorized()
            ->assertJsonStructure(['message']);
    }
}
