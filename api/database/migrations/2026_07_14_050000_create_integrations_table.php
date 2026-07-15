<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-workspace integration credentials (SPEC §16). M1 stores GitHub personal
 * access tokens — the self-hoster's primary private-source path (SPEC Rev 3,
 * §5.1). The GitHub App and Confluence providers are additive at M6.
 *
 * `credentials` is written and read through the model's `encrypted:array` cast:
 * the plaintext token never touches the database, an API response, or the logs
 * (SPEC §13). A non-sensitive `meta` (a last-4 hint, an optional label) drives
 * the masked listing without ever decrypting.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();

            // Backed by App\Enums\IntegrationProvider — `github_pat` at M1.
            $table->string('provider');

            // Encrypted ciphertext (App\Models\Integration `encrypted:array`
            // cast). `text`, because the ciphertext is far longer than the token.
            $table->text('credentials');

            // Non-sensitive display metadata: the last-4 token hint the masked
            // listing shows, and an optional author label. Never the token.
            $table->json('meta')->nullable();

            $table->timestamps();

            // Listing a workspace's integrations, and resolving "does this
            // workspace have a PAT" on every GitHub import, both filter here.
            $table->index(['workspace_id', 'provider']);
        });

        // Realize the SPEC §16 integrations |o--o{ documents edge: the column
        // shipped with the documents table (#17) awaiting this connector. Indexed
        // for "documents imported through this integration"; a soft reference (no
        // cascade) — removing a PAT must never delete the documents already
        // imported with it, whose versions are immutable snapshots.
        Schema::table('documents', function (Blueprint $table) {
            $table->index('integration_id');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['integration_id']);
        });

        Schema::dropIfExists('integrations');
    }
};
