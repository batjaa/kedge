<?php

use App\Enums\TrackedScanStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracked repos (SPEC §16, M3.6, decision 1A) — a workspace-owned record (repo
 * URL + ref + path pattern) Kedge can scan on demand to discover and import
 * matching files into a project. Workspace-scoped: an id in a URL is never an
 * access path (the TrackedRepoPolicy + workspace scope both enforce it).
 *
 * READ-ONLY milestone: nothing scans here (the scan pipeline is #93). The columns
 * land now so preview's overlap query (10A) and #93 build on them — in
 * particular `last_scan_status` (defaulting to a never-scanned value) and the
 * denormalized `last_scan_report` (per-file outcomes; scan *history* is a
 * non-goal, so the latest report suffices).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tracked_repos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();

            // Optional project target — a tracked repo can feed a project or sit
            // unfiled; `nullOnDelete` is defensive (no project delete ships yet).
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();

            // Optional integration for PAT auth (#23); public repos carry none.
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();

            $table->string('repo_url');
            // The branch this repo tracks (2A). Nullable: preview never persists,
            // and create resolves the default branch when omitted (#93).
            $table->string('ref')->nullable();
            $table->string('path_pattern');

            // Backed enum (App\Enums\TrackedScanStatus); `pending` = never scanned.
            $table->string('last_scan_status')->default(TrackedScanStatus::Pending->value);
            $table->text('scan_error')->nullable();
            $table->timestamp('last_scanned_at')->nullable();
            // Denormalized latest scan report — per-file outcomes as JSON (#93).
            $table->json('last_scan_report')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tracked_repos');
    }
};
