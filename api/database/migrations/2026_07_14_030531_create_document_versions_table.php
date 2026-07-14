<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Immutable content snapshots (SPEC 16, 5.2). `content_raw` is what the source
 * returned; `content_normalized` is what renders. `content_hash` is
 * sha256(normalized) and is unique per document, so re-importing identical
 * content dedupes onto the existing version rather than creating a twin.
 *
 * `plain_text` / `projection_version` are the anchor substrate (SPEC 5.4). They
 * are populated by the projection service (#18); left nullable and unwritten
 * here — the columns exist so #18 is additive.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();

            $table->longText('content_raw');
            $table->longText('content_normalized');

            // Anchor substrate — owned by the projection service (#18), nullable
            // and unpopulated at M1. Nothing reads them until M2.
            $table->longText('plain_text')->nullable();
            $table->string('projection_version')->nullable();

            // sha256 hex digest of content_normalized — 64 chars.
            $table->string('content_hash', 64);

            // The source's own version handle (e.g. a git blob sha); raw URLs
            // have none, so nullable.
            $table->string('source_version')->nullable();
            $table->timestamp('synced_at')->nullable();

            $table->timestamps();

            // Same content on re-sync ⇒ no new version (SPEC 5.2).
            $table->unique(['document_id', 'content_hash']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_versions');
    }
};
