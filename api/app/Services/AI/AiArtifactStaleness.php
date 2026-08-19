<?php

namespace App\Services\AI;

use App\Enums\AiRunType;
use App\Enums\SuggestionStatus;
use App\Models\AiRun;
use App\Models\Document;
use App\Services\AI\Artifacts\StalenessReport;

/**
 * Is this completed AI artifact still describing the review it was built from?
 * (m4-ai-agents eng review §4, #136.)
 *
 * A run already records what it read: {@see AiRunLedger::recordScope()} freezes
 * the builder's `document_version_id` and `thread_total` into `ai_runs.input`
 * before the first model call. Staleness is that frozen baseline compared with
 * the same two facts NOW — no new column, no completion-time snapshot that
 * could disagree with what the prompt actually saw.
 *
 * Two movements count, per the eng review: the document was re-versioned (a
 * re-sync, a content update), or the thread population the run was built from
 * changed size. **Known limit, deliberate**: a new comment inside an existing
 * thread moves neither number, so an artifact can be reported fresh while the
 * argument inside a thread has moved on. The spec names version and thread
 * count; widening the signal is a product decision, not a silent one.
 *
 * Deliberately NOT MCP-specific: the web's digest and improve-prompt panels
 * re-attach to a completed run on mount and render it as current with the same
 * blind spot (TODOS: "In-app artifact staleness"), so this is a service both
 * surfaces can reach rather than a concern living inside a tool.
 */
class AiArtifactStaleness
{
    /**
     * Compare a completed run against the document as it stands now.
     *
     * The document is passed in rather than read off the run because every
     * caller has already resolved and AUTHORIZED one — re-reading the relation
     * would be a second query for a row we hold, and one the Policy never saw.
     */
    public function for(AiRun $run, Document $document): StalenessReport
    {
        $builtAgainstVersionId = $this->intOrNull($run->input['document_version_id'] ?? null);
        $threadsAtGeneration = $this->intOrNull($run->input['thread_total'] ?? null);

        $currentVersionId = $this->intOrNull($document->current_version_id);
        $currentThreads = $this->threadsNow($document, $run->type);

        $reasons = [];

        if ($builtAgainstVersionId === null || $threadsAtGeneration === null) {
            // A run whose scope was never recorded cannot be shown to be
            // current. Saying so beats an unearned "fresh": the whole point of
            // this flag is that a consumer trusts it.
            $reasons[] = StalenessReport::REASON_UNKNOWN_BASELINE;
        }

        if ($builtAgainstVersionId !== null && $builtAgainstVersionId !== $currentVersionId) {
            $reasons[] = StalenessReport::REASON_VERSION_MOVED;
        }

        if ($threadsAtGeneration !== null && $threadsAtGeneration !== $currentThreads) {
            $reasons[] = StalenessReport::REASON_THREADS_MOVED;
        }

        return new StalenessReport(
            stale: $reasons !== [],
            reasons: $reasons,
            builtAgainstVersionId: $builtAgainstVersionId,
            currentVersionId: $currentVersionId,
            threadsAtGeneration: $threadsAtGeneration,
            currentThreads: $currentThreads,
        );
    }

    /**
     * The thread population this run type was built from, counted as it stands
     * now — the live counterpart to the builder's recorded `thread_total`.
     *
     * The two run types read different populations, so comparing either against
     * a single "all threads" count would report a false move on every
     * improve-prompt. The rules mirror the builders exactly:
     *
     *  - **digest** reads every thread on the document (DigestPromptBuilder).
     *  - **improve-prompt** reads OPEN threads that still carry something to act
     *    on — at least one live comment that is not a declined suggestion
     *    (ImprovePromptBuilder). Resolving a thread or declining its last
     *    suggestion therefore ages the artifact, which is right: those are
     *    exactly the triage decisions that make marching orders obsolete.
     *
     * Mirroring is drift-prone by nature, so it is pinned by a test that asserts
     * this count equals what the builder itself records for the same document
     * (ArtifactStalenessTest) — a builder change that moves one and not the
     * other fails there rather than quietly mis-flagging artifacts.
     */
    public function threadsNow(Document $document, AiRunType $type): int
    {
        return match ($type) {
            AiRunType::ImprovePrompt => $document->threads()
                ->open()
                ->whereHas(
                    'comments',
                    fn ($query) => $query->withoutTrashed()->where(
                        fn ($comment) => $comment
                            ->whereNull('suggestion_status')
                            ->orWhere('suggestion_status', '!=', SuggestionStatus::Declined->value),
                    ),
                )
                ->count(),
            default => $document->threads()->count(),
        };
    }

    /**
     * `input` is a free-form JSON column, so a key can be present and useless.
     * Anything that is not a whole number reads as "not recorded" rather than
     * being cast into a confident comparison.
     */
    private function intOrNull(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }

        if (is_string($value) && ctype_digit($value)) {
            return (int) $value;
        }

        return null;
    }
}
