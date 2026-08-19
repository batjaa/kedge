<?php

namespace App\Services\AI\Artifacts;

/**
 * What has moved in the review since an AI artifact was generated (m4-ai-agents
 * eng review §4, #136).
 *
 * A digest or an improve-the-doc prompt is a photograph of one moment: the
 * document at one version, the review at one thread count. Handed to an agent a
 * day later it still reads as marching orders, and nothing in the words says
 * Wednesday happened. This report is that missing sentence — carried alongside
 * every served artifact, with the numbers behind it so the consumer can decide
 * for itself rather than trusting a bare boolean.
 *
 * Both sides of each comparison are exposed on purpose. "Stale" is a judgement;
 * "built against version 7, the document is now on version 9" is a fact, and an
 * agent that wants to re-read exactly what changed needs the fact.
 */
final class StalenessReport
{
    /** The document was re-synced (or otherwise re-versioned) after the run. */
    public const REASON_VERSION_MOVED = 'document_version_changed';

    /** Threads were opened, resolved, or triaged away since the run. */
    public const REASON_THREADS_MOVED = 'thread_count_changed';

    /**
     * The conversation moved INSIDE the threads that were already there — a new
     * comment, an edit, a deletion, a suggestion accepted or declined. None of
     * that changes the thread count, and an improve-the-doc prompt missing an
     * edit the author approved five minutes ago is exactly the artifact this
     * flag exists to catch.
     */
    public const REASON_ACTIVITY_MOVED = 'review_activity_changed';

    /**
     * The run never recorded what it was built against, so freshness cannot be
     * proven. Reported as stale: "we cannot tell" and "it is current" are
     * different answers, and only one of them is safe to act on.
     */
    public const REASON_UNKNOWN_BASELINE = 'baseline_unknown';

    /**
     * @param  list<string>  $reasons  Empty exactly when the artifact is fresh.
     */
    public function __construct(
        public readonly bool $stale,
        public readonly array $reasons,
        public readonly ?int $builtAgainstVersionId,
        public readonly ?int $currentVersionId,
        public readonly ?int $threadsAtGeneration,
        public readonly int $currentThreads,
        public readonly ?string $reviewLastChangedAt = null,
    ) {}

    /**
     * The wire shape, flat on purpose: `stale` is the field a consumer must not
     * miss, and burying it one level down behind a `staleness` key is how it
     * gets missed.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'stale' => $this->stale,
            'stale_reasons' => $this->reasons,
            'built_against_version_id' => $this->builtAgainstVersionId,
            'current_version_id' => $this->currentVersionId,
            'threads_at_generation' => $this->threadsAtGeneration,
            'current_threads' => $this->currentThreads,
            // When the review itself last moved — the timestamp behind
            // REASON_ACTIVITY_MOVED, so a consumer can see how far past the run
            // the conversation has travelled rather than only that it has.
            'review_last_changed_at' => $this->reviewLastChangedAt,
        ];
    }

    /**
     * The sentence a consumer renders when it renders nothing else — prose, so
     * an agent that only reads the text still learns the artifact has aged.
     */
    public function statement(): ?string
    {
        if (! $this->stale) {
            return null;
        }

        $moved = [];

        if (in_array(self::REASON_VERSION_MOVED, $this->reasons, true)) {
            $moved[] = sprintf(
                'the document has moved from version id %s to version id %s',
                $this->builtAgainstVersionId ?? 'unknown',
                $this->currentVersionId ?? 'unknown',
            );
        }

        if (in_array(self::REASON_THREADS_MOVED, $this->reasons, true)) {
            $moved[] = sprintf(
                'the review has moved from %s to %d threads',
                $this->threadsAtGeneration ?? 'unknown',
                $this->currentThreads,
            );
        }

        if (in_array(self::REASON_ACTIVITY_MOVED, $this->reasons, true)) {
            $moved[] = sprintf(
                'the review was last changed at %s, after this was generated',
                $this->reviewLastChangedAt ?? 'an unknown time',
            );
        }

        if (in_array(self::REASON_UNKNOWN_BASELINE, $this->reasons, true)) {
            $moved[] = 'it does not record what it was generated from';
        }

        return 'Do not treat this artifact as current: '.implode('; ', $moved)
            .'. Re-read the document and its threads before acting on it.';
    }
}
