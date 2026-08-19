<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the requester ASKED FOR, in their own words (SPEC §14, §16 — M4 #139).
 *
 * Every run type up to now was fully described by `type` + `target` + `variant`:
 * "the digest of document 7", "an accept-stance reply draft on thread 12". Ask
 * is the first type whose request carries free-form content — a question the
 * reader typed, and optionally the passage they had selected when they typed it
 * — and the queued job has to be able to read it, because only the run id
 * travels on the queue.
 *
 * It is a column of its own rather than a corner of `input` because the two
 * answer different questions and are written by different actors at different
 * times: `request` is what the HUMAN asked, written once at mint; `input` is
 * what the ASSEMBLY read, written by the generator and deliberately frozen at
 * the first attempt. Folding the question into `input` would make the ledger's
 * freeze rule silently drop the assembly metadata of every ask.
 *
 * `variant` stays what it always was — a short, opaque dedupe key — and is null
 * for an ask, which never dedupes at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            $table->json('request')->nullable()->after('variant');
        });
    }

    public function down(): void
    {
        Schema::table('ai_runs', function (Blueprint $table) {
            $table->dropColumn('request');
        });
    }
};
