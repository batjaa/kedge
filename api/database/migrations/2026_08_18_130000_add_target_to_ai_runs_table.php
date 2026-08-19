<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a run was asked ABOUT, when that is narrower than the document (SPEC §14,
 * §17 — M4 #134).
 *
 * The digest and the improve-prompt read a whole document, so `document_id`
 * alone identifies them. The per-target features do not: a split is requested on
 * ONE comment, and a document with three sprawling comments must be able to hold
 * three independent split runs. Without a target the server-side dedupe probe
 * (m4 eng review §8) would key on (document, type) and hand comment B's requester
 * the run belonging to comment A — the wrong proposals, silently.
 *
 * Nullable by design: a document-wide run has no target, and the probe reads
 * "no target" as its own distinct bucket rather than a wildcard.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            // Morph rather than a comment FK: the same column pair carries every
            // narrower target M4 adds, and the run `type` already tells the
            // reader which class to expect.
            $table->nullableMorphs('target');

            // The dedupe probe and the panel's re-attach both read "this
            // document's runs of this type FOR THIS TARGET, newest first".
            $table->index(['document_id', 'type', 'target_type', 'target_id', 'id'], 'ai_runs_target_lookup_index');
        });
    }

    public function down(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            $table->dropIndex('ai_runs_target_lookup_index');
            $table->dropMorphs('target');
        });
    }
};
