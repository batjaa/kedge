<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Documents gain a nullable `project_id` (SPEC §16, M3.6): a document attaches
 * to at most one project and moves freely — the absence of a project IS Unfiled,
 * not a row. `nullOnDelete` is defensive (no project delete ships this
 * milestone); a moved doc keeps its project through re-imports. The home list
 * filters on it (`?project=`), so the column is indexed — but by a companion
 * migration, because `constrained()` declares only the FK constraint and neither
 * Postgres nor SQLite auto-indexes the referencing column off that.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->foreignId('project_id')
                ->nullable()
                ->after('workspace_id')
                ->constrained()
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('project_id');
        });
    }
};
