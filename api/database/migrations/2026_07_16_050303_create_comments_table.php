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
        Schema::create('comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('threads')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();
            $table->string('type')->default('comment');
            $table->longText('body_md');
            $table->longText('proposed_text')->nullable();
            $table->string('suggestion_status')->nullable();
            $table->string('client')->default('web');
            $table->string('idempotency_key')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->timestamps();

            $table->unique(['author_id', 'idempotency_key']);
        });

        Schema::table('threads', function (Blueprint $table) {
            $table->foreign('forked_from_comment_id')
                ->references('id')
                ->on('comments')
                ->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('threads', function (Blueprint $table) {
            $table->dropForeign(['forked_from_comment_id']);
        });

        Schema::dropIfExists('comments');
    }
};
