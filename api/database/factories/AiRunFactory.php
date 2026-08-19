<?php

namespace Database\Factories;

use App\Enums\AiRunStatus;
use App\Enums\AiRunType;
use App\Models\AiRun;
use App\Models\Document;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiRun>
 */
class AiRunFactory extends Factory
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
            'created_by' => User::factory(),
            'type' => AiRunType::Digest,
            'status' => AiRunStatus::Pending,
            'model' => 'claude-sonnet-5',
        ];
    }

    public function running(): static
    {
        return $this->state(['status' => AiRunStatus::Running]);
    }

    public function completed(): static
    {
        return $this->state([
            'status' => AiRunStatus::Completed,
            'output' => [
                'themes' => [],
                'contention_points' => [],
                'consensus' => [],
                'action_items' => [],
                'coverage' => [
                    'covered' => 0,
                    'total' => 0,
                    'chunked' => false,
                    'statement' => 'No review threads yet — nothing to digest.',
                ],
            ],
            'tokens' => 0,
            'cost' => 0,
        ]);
    }

    public function failed(): static
    {
        return $this->state([
            'status' => AiRunStatus::Failed,
            'error' => [
                'kind' => 'transient',
                'code' => 'provider_overloaded',
                'message' => 'Generation failed — retry.',
            ],
        ]);
    }
}
