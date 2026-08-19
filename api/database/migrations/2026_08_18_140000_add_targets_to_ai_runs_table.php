<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sub-document targets for the AI run ledger (SPEC §14, §17 — M4 #133).
 *
 * The digest and the improve-prompt read a whole document, so `document_id`
 * alone identified them. The triage pair does not: a reply draft and a thread
 * summary are taken over ONE thread, and a split proposal over one comment. The
 * run still belongs to its document (that is what the workspace scoping and the
 * cost rollup hang off), so the target is an ADDITIONAL, nullable narrowing —
 * never a replacement.
 *
 * `variant` is the last piece of "the same request": a reply draft in the
 * `accept` stance is not the request a `push_back` draft would answer, so the
 * two must not dedupe into each other. Document-wide runs leave both null and
 * behave exactly as they did before this migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            // target_type + target_id, with the morph index Laravel adds itself.
            $table->nullableMorphs('target');

            // The request discriminator within a (target, type) — today the
            // reply-draft stance. Short and opaque on purpose: it is a dedupe
            // key, not a payload.
            $table->string('variant', 32)->nullable();

            // The dedupe probe and the re-attach read both resolve the full
            // narrowed key — this document's runs of this type, for this target
            // and variant, newest first. The pre-existing (document_id, type, …)
            // indexes stop being selective the moment a document carries a run
            // per thread, which is exactly what the triage pair produces.
            $table->index(
                ['document_id', 'type', 'target_type', 'target_id', 'variant', 'id'],
                'ai_runs_scoped_lookup_index',
            );
        });
    }

    public function down(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            $table->dropIndex('ai_runs_scoped_lookup_index');
            $table->dropMorphs('target');
            $table->dropColumn('variant');
        });
    }
};
