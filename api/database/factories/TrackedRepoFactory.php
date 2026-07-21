<?php

namespace Database\Factories;

use App\Enums\TrackedScanStatus;
use App\Models\TrackedRepo;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TrackedRepo>
 */
class TrackedRepoFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $owner = fake()->unique()->userName();
        $repo = fake()->slug(2);

        return [
            'workspace_id' => Workspace::factory(),
            'project_id' => null,
            'integration_id' => null,
            'repo_url' => "https://github.com/{$owner}/{$repo}",
            'ref' => 'main',
            'path_pattern' => 'docs/**/*.md',
            'last_scan_status' => TrackedScanStatus::Pending,
            'created_by' => null,
        ];
    }
}
