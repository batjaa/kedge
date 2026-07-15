<?php

namespace Database\Factories;

use App\Enums\IntegrationProvider;
use App\Models\Integration;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Integration>
 */
class IntegrationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $token = 'ghp_'.fake()->regexify('[A-Za-z0-9]{36}');

        return [
            'workspace_id' => Workspace::factory(),
            'provider' => IntegrationProvider::GithubPat,
            'credentials' => ['token' => $token],
            'meta' => ['token_last_four' => substr($token, -4)],
        ];
    }

    /**
     * A GitHub PAT integration carrying a specific token (so a test can assert the
     * exact Authorization header the connector sends, and that the token never
     * appears in any response or log).
     */
    public function withToken(string $token): static
    {
        return $this->state([
            'credentials' => ['token' => $token],
            'meta' => ['token_last_four' => substr($token, -4)],
        ]);
    }
}
