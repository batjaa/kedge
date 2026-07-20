<?php

namespace Database\Factories;

use App\Models\Approval;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Approval>
 */
class ApprovalFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'document_id' => Document::factory(),
            'workspace_id' => fn (array $attributes) => Document::query()
                ->find($attributes['document_id'])
                ?->workspace_id,
            'document_version_id' => fn (array $attributes) => DocumentVersion::factory()
                ->for(Document::query()->find($attributes['document_id']))
                ->create()
                ->id,
            'user_id' => User::factory(),
            'revoked_at' => null,
            'created_at' => now(),
        ];
    }

    public function revoked(): static
    {
        return $this->state(['revoked_at' => now()->subMinute()]);
    }
}
