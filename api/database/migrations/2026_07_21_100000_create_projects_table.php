<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Projects (SPEC §16, M3.6) — free containers inside a workspace for "what
 * you're working on", never where content lives. Workspace-scoped: an id in a
 * URL is never an access path (the ProjectPolicy + workspace scope both enforce
 * it). `name` is unique per workspace (decision 6A) — a friendly 422 surfaces
 * the collision. No delete in this milestone: a project with docs poses
 * questions v1 doesn't need to answer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();

            $table->string('name', 100);
            $table->string('slug');
            $table->text('description')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // Name is unique per workspace (6A) — the collision the store/update
            // requests turn into a friendly 422. Slug is unique per workspace too
            // so a project has a stable, non-colliding handle within its scope.
            $table->unique(['workspace_id', 'name']);
            $table->unique(['workspace_id', 'slug']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
