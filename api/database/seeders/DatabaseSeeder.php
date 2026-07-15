<?php

namespace Database\Seeders;

use App\Models\User;
use App\Services\SystemWorkspace;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // The reserved demo workspace (SPEC 10.3, #25) — created deterministically
        // so it exists before the first demo import. resolve() is idempotent (and
        // the demo controller falls back to it anyway), so re-seeding is safe.
        app(SystemWorkspace::class)->resolve();

        // User::factory(10)->create();

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);
    }
}
