<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('anchors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('threads')->cascadeOnDelete();
            $table->foreignId('document_version_id')->constrained('document_versions')->cascadeOnDelete();
            $table->text('exact');
            $table->text('prefix')->nullable();
            $table->text('suffix')->nullable();
            $table->unsignedBigInteger('start');
            $table->unsignedBigInteger('end');
            $table->json('heading_path')->nullable();
            $table->string('projection_version');
            $table->string('state')->default('anchored');
            $table->timestamps();

            $table->index(['thread_id', 'document_version_id']);
            $table->index(['document_version_id', 'start']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('anchors');
    }
};
