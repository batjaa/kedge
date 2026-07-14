<?php

namespace Database\Factories;

use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DocumentVersion>
 */
class DocumentVersionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $content = "# {$this->faker->sentence(3)}\n\n{$this->faker->paragraph()}\n";

        return [
            'document_id' => Document::factory(),
            'content_raw' => $content,
            'content_normalized' => $content,
            'content_hash' => hash('sha256', $content),
            'source_version' => null,
            'synced_at' => now(),
        ];
    }
}
