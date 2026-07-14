<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Documents = stable identity (SPEC 16). The immutable snapshots live in
 * document_versions; M1 produces exactly one per document, but the two-table
 * shape, `(document_id, content_hash)` uniqueness, and `current_version_id`
 * exist now so re-sync (M3) adds versions without migration surgery.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();

            // Nullable, no FK: integrations arrives with the PAT connector (#23).
            // The column exists now so that connector is additive (SPEC 5.1).
            $table->unsignedBigInteger('integration_id')->nullable();

            // Provenance. source_url is nullable because upload/paste (a later
            // connector) has no URL; the raw-URL tracer always sets it.
            $table->string('source_type');
            $table->string('source_url')->nullable();
            $table->json('source_meta')->nullable();

            $table->string('title');
            $table->string('format')->default('md');

            // The version currently rendered. Nullable (unset until the first
            // import lands a version) and deliberately un-constrained: a FK here
            // would be circular with document_versions.document_id. Indexed, and
            // only ever set to an id that firstOrCreate just returned.
            $table->unsignedBigInteger('current_version_id')->nullable()->index();

            $table->string('status')->default('importing');
            $table->string('last_sync_status')->default('ok');
            $table->text('sync_error')->nullable();
            $table->string('lifecycle_status')->default('draft');

            // Demo-mode TTL (#25). Column exists now; nothing writes it yet.
            $table->timestamp('expires_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['workspace_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('documents');
    }
};
