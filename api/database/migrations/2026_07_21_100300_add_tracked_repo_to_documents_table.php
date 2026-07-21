<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Documents gain their tracked-repo provenance (SPEC §16, M3.6, decision 1A):
 * `tracked_repo_id` (which tracked repo imported it — survives project moves,
 * nulled when the tracked repo is deleted) and `tracked_path` (the repo-relative
 * path a scan imported it from). The composite unique index on
 * `(tracked_repo_id, tracked_path)` is the scan diff key and makes a double
 * import structurally impossible — NULLs are distinct, so ordinary hand-imported
 * documents (both columns null) never collide. A standalone `tracked_path` index
 * serves preview's workspace-wide overlap query (10A). No scan pipeline yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->foreignId('tracked_repo_id')
                ->nullable()
                ->after('project_id')
                ->constrained()
                ->nullOnDelete();

            $table->string('tracked_path')->nullable()->after('tracked_repo_id');

            // Scan diff key — one document per (tracked repo, repo path).
            $table->unique(['tracked_repo_id', 'tracked_path']);
            // Preview's overlap query filters the workspace's docs by tracked_path.
            $table->index('tracked_path');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropUnique(['tracked_repo_id', 'tracked_path']);
            $table->dropIndex(['tracked_path']);
            $table->dropConstrainedForeignId('tracked_repo_id');
            $table->dropColumn('tracked_path');
        });
    }
};
