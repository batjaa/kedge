<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Index the project foreign keys (SPEC §16, M3.6). A `foreignId()->constrained()`
 * declares a foreign-key CONSTRAINT, not an index — Postgres and SQLite (unlike
 * MySQL) never auto-index the referencing column, so the home list's `?project=`
 * filter (`documents.project_id`) and the panel's project-scoped tracked-repo
 * read (`tracked_repos.project_id`) would both sequential-scan without these.
 *
 * `documents.tracked_path` is deliberately NOT indexed here: the standalone
 * `tracked_path` index from the provenance migration already serves the overlap
 * query (which filters `WHERE tracked_path IN (...)`), and the composite unique
 * `(tracked_repo_id, tracked_path)` leads with the wrong column to cover it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->index('project_id');
        });

        Schema::table('tracked_repos', function (Blueprint $table) {
            $table->index('project_id');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['project_id']);
        });

        Schema::table('tracked_repos', function (Blueprint $table) {
            $table->dropIndex(['project_id']);
        });
    }
};
