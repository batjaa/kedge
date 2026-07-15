<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes the demo-prune query (SPEC §10.3, #25). The scheduled reaper selects
 * `where workspace_id = <system> and expires_at <= now()`, so a composite index
 * on exactly those two columns keeps it index-covered as demo volume grows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->index(['workspace_id', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['workspace_id', 'expires_at']);
        });
    }
};
