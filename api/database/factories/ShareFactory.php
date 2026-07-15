<?php

namespace Database\Factories;

use App\Enums\ShareVisibility;
use App\Models\Document;
use App\Models\Share;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Share>
 */
class ShareFactory extends Factory
{
    /**
     * Define the model's default state — an active `link` share. The plaintext
     * token is thrown away after hashing (production shows it once); tests that
     * need it use {@see withToken()}.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'document_id' => Document::factory(),
            'token_hash' => Share::hashToken(Str::random(48)),
            'visibility' => ShareVisibility::Link,
            'expires_at' => null,
            'revoked_at' => null,
        ];
    }

    /**
     * Pin a known plaintext token so a test can exercise the public read path.
     */
    public function withToken(string $token): static
    {
        return $this->state(['token_hash' => Share::hashToken($token)]);
    }

    public function revoked(): static
    {
        return $this->state(['revoked_at' => now()->subMinute()]);
    }

    /**
     * Expired: `expires_at` in the past.
     */
    public function expired(): static
    {
        return $this->state(['expires_at' => now()->subDay()]);
    }

    public function expiresAt(\DateTimeInterface $at): static
    {
        return $this->state(['expires_at' => $at]);
    }
}
