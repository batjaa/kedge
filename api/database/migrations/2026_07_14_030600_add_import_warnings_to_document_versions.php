<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Normalization warnings are a property of the imported snapshot (SPEC 5.2, §19):
 * a failed image fetch or a degraded HTML conversion is honest about *this*
 * version, not the document identity. Nullable JSON — an import with nothing to
 * warn about leaves it null, and the web renders the author-facing warning list
 * only when the list is non-empty.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->json('import_warnings')->nullable()->after('projection_version');
        });
    }

    public function down(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->dropColumn('import_warnings');
        });
    }
};
