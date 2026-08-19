<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Agent tokens (SPEC §15, §16; M4 #131) — the standard Sanctum
 * `personal_access_tokens` table, published verbatim from the package so
 * Sanctum's own model, hashing, and `findToken()` keep working untouched.
 *
 * Kedge's product name for a row here is an **Agent Token** (CONTEXT.md): the
 * named, revocable, workspace-scoped credential a member mints for one agent.
 * The workspace scope rides in `abilities` as a single `workspace:{id}` entry,
 * which the shared Policy membership trait checks on every authorization —
 * scoping is never a per-tool concern.
 *
 * Nothing about the first-party SPA cookie path changes: those requests carry a
 * TransientToken, not a row here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->text('name');
            // The SHA-256 digest of the plaintext — the plaintext itself is
            // returned exactly once, at creation, and never stored.
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
    }
};
