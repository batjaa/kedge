<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Candidate-capable document version lineage (ADR 0001). `parent_version_id`
 * follows the same un-constrained pointer precedent as documents.current_version_id:
 * indexed, nullable, and intentionally not a hard FK.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->string('kind')->default('mainline')->after('document_id');
            $table->unsignedBigInteger('parent_version_id')->nullable()->after('kind')->index();
        });

        DB::table('document_versions')->update(['kind' => 'mainline']);

        DB::table('document_versions')
            ->select('document_id')
            ->distinct()
            ->orderBy('document_id')
            ->pluck('document_id')
            ->each(function (int $documentId): void {
                $previousVersionId = null;

                DB::table('document_versions')
                    ->where('document_id', $documentId)
                    ->orderBy('id')
                    ->pluck('id')
                    ->each(function (int $versionId) use (&$previousVersionId): void {
                        DB::table('document_versions')
                            ->where('id', $versionId)
                            ->update(['parent_version_id' => $previousVersionId]);

                        $previousVersionId = $versionId;
                    });
            });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->dropIndex(['parent_version_id']);
            $table->dropColumn(['kind', 'parent_version_id']);
        });
    }
};
