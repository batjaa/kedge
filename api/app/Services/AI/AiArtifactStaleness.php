<?php

namespace App\Services\AI;

use App\Enums\AiRunType;
use App\Enums\SuggestionStatus;
use App\Models\AiRun;
use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Services\AI\Artifacts\StalenessReport;
use Carbon\Carbon;
use Carbon\CarbonInterface;

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
 * Three movements count. The eng review names two — the document was
 * re-versioned (a re-sync, a content update), or the thread population the run
 * was built from changed size — and a third is added because those two share a
 * blind spot: neither moves when the conversation changes INSIDE the threads
 * that were already there. An improve-the-doc prompt that omits a suggested edit
 * the author accepted five minutes ago, while reporting itself current, is
 * exactly the artifact this flag exists to catch, so review activity is the
 * third signal (#136 review gate).
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
        $reviewChangedAt = $this->reviewLastChangedAt($document);

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

        if ($this->reviewMovedAfter($reviewChangedAt, $run)) {
            $reasons[] = StalenessReport::REASON_ACTIVITY_MOVED;
        }

        return new StalenessReport(
            stale: $reasons !== [],
            reasons: $reasons,
            builtAgainstVersionId: $builtAgainstVersionId,
            currentVersionId: $currentVersionId,
            threadsAtGeneration: $threadsAtGeneration,
            currentThreads: $currentThreads,
            reviewLastChangedAt: $reviewChangedAt?->toJSON(),
        );
    }

    /**
     * When this document's review last moved: a thread opened or triaged, a
     * comment posted, edited, deleted, a suggestion accepted or declined, or an
     * orphaned thread re-attached to a passage.
     *
     * All three tables are read because they move independently — a thread's
     * status change never touches its comments, a new comment never has to touch
     * its thread, and a manual re-anchor writes only the anchor while changing
     * the quote an improve-the-doc prompt would put in front of a coding agent.
     * Trashed comments are INCLUDED: a deletion is movement, and excluding it
     * would let a review shrink invisibly.
     */
    private function reviewLastChangedAt(Document $document): ?CarbonInterface
    {
        $threads = Thread::query()->where('document_id', $document->id);

        $latest = collect([
            (clone $threads)->max('updated_at'),
            Comment::withTrashed()
                ->whereIn('thread_id', (clone $threads)->select('id'))
                ->max('updated_at'),
            Anchor::query()
                ->whereIn('thread_id', (clone $threads)->select('id'))
                ->max('updated_at'),
        ])
            ->filter()
            ->map(fn (mixed $value): CarbonInterface => Carbon::parse((string) $value))
            ->max();

        return $latest instanceof CarbonInterface ? $latest : null;
    }

    /**
     * Did the review move after this run was ASKED FOR?
     *
     * Measured from `created_at` rather than from the completion timestamp on
     * purpose. The prompt is assembled somewhere between the two, and the exact
     * moment is not recorded — so comparing against completion would call an
     * artifact fresh when a comment landed mid-generation and never reached it.
     * Comparing against the request instead can only err the safe way: an
     * artifact reported stale that in fact read the change.
     *
     * Comparison is second-resolution, matching how these timestamps are stored;
     * `gt` (not `gte`) keeps activity in the run's own second — the thread a
     * digest was requested about milliseconds after it was opened — from reading
     * as movement.
     *
     * **The residual gap, named**: a change landing in the SAME second the run
     * was requested, but after the prompt was assembled, is invisible here. `gte`
     * would close it by declaring every artifact requested in the same second as
     * the last comment permanently stale from birth — which is the common
     * comment-then-generate flow, so the flag would become noise exactly where it
     * needs to be trusted. Closing it properly means the builders freezing a
     * monotonic review watermark (max comment/anchor id) into `ai_runs.input` at
     * assembly, which is a change to the builders and a follow-up ticket.
     */
    private function reviewMovedAfter(?CarbonInterface $changedAt, AiRun $run): bool
    {
        $requestedAt = $run->created_at;

        return $changedAt !== null && $requestedAt !== null && $changedAt->gt($requestedAt);
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
