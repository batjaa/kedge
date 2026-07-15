<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether this version's MDX compiled (SPEC 6.1, #20). Additive and nullable:
 *   - null  → not an MDX document (md/html) — the flag does not apply;
 *   - true  → MDX compiled cleanly through the hardened pipeline;
 *   - false → rejected or uncompilable — the reading surface renders the
 *             plain-markdown fallback + banner without recompiling to find out.
 *
 * Set at import by the projection endpoint's real compile validation. Nothing
 * before #20 wrote it, so existing rows stay null (correctly "not applicable").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->boolean('mdx_ok')->nullable()->after('projection_version');
        });
    }

    public function down(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->dropColumn('mdx_ok');
        });
    }
};
