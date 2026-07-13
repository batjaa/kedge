<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Additive: GitHub identity lives on the user record (ticket #6). The
     * workspace-level `integrations` table (SPEC 16) stays reserved for source
     * connectors — login is not an integration. `avatar_url` already exists,
     * so only the provider id is new. Unique so a GitHub account maps to
     * exactly one Kedge user; nullable so email+password accounts have none.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('github_id')->nullable()->unique()->after('avatar_url');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['github_id']);
            $table->dropColumn('github_id');
        });
    }
};
