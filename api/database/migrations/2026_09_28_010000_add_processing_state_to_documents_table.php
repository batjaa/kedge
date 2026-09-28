<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // A monotonic token makes an asynchronous result conditional on the
            // request that still owns the document. It is intentionally a property
            // of the document, not of ScanReport: scan reports are history.
            $table->unsignedBigInteger('sync_generation')->default(1)->after('last_sync_status');
            $table->timestamp('sync_started_at')->nullable()->after('sync_generation');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn(['sync_generation', 'sync_started_at']);
        });
    }
};
