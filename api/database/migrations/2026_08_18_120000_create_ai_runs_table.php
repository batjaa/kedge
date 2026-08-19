<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The AI run ledger (SPEC §16, M4). One row per queued generation: what was
 * asked for, what came back, and what it cost. Deliberately APPEND-ONLY history —
 * a retry mints a new row rather than reviving a failed one, so "AI cost/day"
 * (SPEC §19) survives every retry and a failed run keeps its error forever.
 *
 * `input` holds prompt METADATA and scope refs (thread ids, chunk count, budget
 * math) — never the assembled prompt text and never a credential.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('document_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->index()->constrained('users')->nullOnDelete();

            $table->string('type');
            $table->string('status');

            $table->json('input')->nullable();
            $table->json('output')->nullable();
            $table->json('error')->nullable();

            $table->string('model')->nullable();
            $table->unsignedInteger('tokens')->nullable();
            $table->decimal('cost', 10, 6)->nullable();

            $table->timestamps();

            // The dedupe probe (eng review §8) and the panel's re-attach read both
            // resolve "this document's runs of this type, newest first".
            $table->index(['document_id', 'type', 'status']);
            $table->index(['document_id', 'type', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_runs');
    }
};
