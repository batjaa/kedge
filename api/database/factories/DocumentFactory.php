<?php

namespace Database\Factories;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Models\Document;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Document>
 */
class DocumentFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'workspace_id' => Workspace::factory(),
            'source_type' => SourceType::RawUrl,
            'source_url' => 'https://raw.example.test/'.fake()->slug().'.md',
            'source_meta' => null,
            'title' => fake()->sentence(3),
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
            'last_sync_status' => SyncStatus::Ok,
            'lifecycle_status' => LifecycleStatus::Draft,
        ];
    }

    /**
     * A document whose first import landed a version.
     */
    public function ready(): static
    {
        return $this->state(['status' => DocumentStatus::Ready]);
    }

    /**
     * A document whose first import never produced a version.
     */
    public function failed(string $error = 'Import failed.'): static
    {
        return $this->state([
            'status' => DocumentStatus::Failed,
            'last_sync_status' => SyncStatus::Failed,
            'sync_error' => $error,
        ]);
    }
}
