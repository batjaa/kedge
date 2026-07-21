<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approvals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('document_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('document_version_id')->index()->constrained('document_versions')->cascadeOnDelete();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            $table->index(['document_id', 'revoked_at']);
            $table->index(['document_id', 'document_version_id', 'user_id'], 'approvals_doc_version_user_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approvals');
    }
};
