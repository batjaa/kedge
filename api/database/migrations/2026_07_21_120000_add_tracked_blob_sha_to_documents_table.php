<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The re-scan diff needs a per-document record of the upstream blob sha it last
 * imported/re-synced (SPEC §16, M3.6, #94). The GitHub blob connector fetches the
 * raw file body and records nothing version-ish (`document_versions.source_version`
 * stays null), so change detection can't ride the version row. Instead the scan —
 * which already lists the git tree and so holds the authoritative blob sha per
 * path — stamps it here, the fourth member of the provenance quartet alongside
 * `tracked_repo_id` / `tracked_path`. Re-scan compares the tree's current blob sha
 * against this: equal → unchanged, differ (or null baseline) → re-sync.
 *
 * Nullable: hand-imported documents never carry one, and a #93-minted document
 * created before this column existed reads null (treated as changed on the next
 * re-scan, which is a content-hash no-op that self-heals the baseline).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->string('tracked_blob_sha')->nullable()->after('tracked_path');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('tracked_blob_sha');
        });
    }
};
