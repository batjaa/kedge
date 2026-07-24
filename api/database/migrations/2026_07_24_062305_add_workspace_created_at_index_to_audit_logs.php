<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The dashboard activity feed (M3.8 #111, decision 10A) reads a workspace's
     * recent audit rows newest-first: `where workspace_id = ? order by created_at
     * desc`. The table already carries a standalone `workspace_id` index, but the
     * feed's ORDER BY would then sort in memory; a composite (workspace_id,
     * created_at) lets the one index satisfy both the filter and the ordering,
     * keeping the paginated read cheap as the trail grows. Purely additive — no
     * column or data change — so it ships safely alongside the endpoint.
     */
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->index(['workspace_id', 'created_at'], 'audit_logs_workspace_id_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropIndex('audit_logs_workspace_id_created_at_index');
        });
    }
};
