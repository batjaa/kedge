<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Models\Comment;
use App\Services\AI\Agents\CommentSplitAgent;
use App\Services\AI\AiCostCalculator;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Builders\CommentSplitPromptBuilder;
use App\Services\AI\Exceptions\ContentRefusedException;
use App\Services\AI\Exceptions\UnparseableOutputException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\Prompt\Coverage;
use App\Services\AI\Split\SplitAnchorLocator;
use Illuminate\Support\Str;
use Laravel\Ai\Responses\Data\FinishReason;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Laravel\Ai\Responses\TextResponse;

/**
 * Proposes how one sprawling comment divides into separate threads (SPEC §14,
 * user story 6).
 *
 * **Nothing here writes review data.** The generator's entire product is a list
 * of proposals stored on the run — inert JSON. A proposal becomes a thread only
 * when a human approves it and the web calls the ordinary fork endpoint with the
 * proposal's anchor, which re-validates that anchor against the live projection
 * and resolves the ordinary Policy (hard rule 5, m4 eng review §9). An
 * unapproved proposal writes nothing, forever.
 *
 * Anchors are computed HERE, from the model's verbatim quote, never taken from
 * the model as offsets — see {@see SplitAnchorLocator}. A quote that cannot be
 * found in the thread's passage yields a proposal with no anchor, which forks
 * exactly like a manual fork (inheriting the source thread's anchors, M2
 * behaviour), rather than a proposal pointing at the wrong sentence.
 *
 * Everything that is not split-specific is inherited from the digest's shape:
 * spend recorded as it is incurred, a refusal or an unusable shape treated as a
 * deterministic failure, and coverage that confesses whatever was left out.
 */
class CommentSplitGenerator implements GeneratesAiRun
{
    /** Longest proposed title kept, before an explicit cut mark. */
    private const MAX_TITLE_CHARS = 200;

    /** Longest proposed fragment kept, before an explicit cut mark. */
    private const MAX_FRAGMENT_CHARS = 8000;

    public function __construct(
        private readonly CommentSplitPromptBuilder $builder,
        private readonly AiCostCalculator $costs,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $comment = $this->target($run);

        $assembled = $this->builder->build($comment);

        // Scope first, model call second: a run that fails still says what it
        // was assembled from.
        $this->ledger->recordScope($run, $assembled->meta);

        if ($assembled->isEmpty()) {
            return new AiGeneration([
                'proposals' => [],
                'coverage' => $assembled->coverage
                    ->withNote('The comment was too large to read in one pass, so no split was proposed.')
                    ->toArray(),
            ]);
        }

        [$splits, $coverage] = $this->propose($run, $assembled->chunks, $assembled->coverage);
        [$proposals, $coverage] = $this->anchored($comment, $splits, $coverage);

        return new AiGeneration([
            'proposals' => $proposals,
            'coverage' => $coverage->toArray(),
        ]);
    }

    /**
     * The comment this run was requested on. The target is part of the ledger
     * row, so a job that outlives its comment simply fails rather than
     * generating against the wrong one.
     */
    private function target(AiRun $run): Comment
    {
        $comment = $run->target;

        if (! $comment instanceof Comment) {
            throw new UnparseableOutputException('This split run has no comment to divide.');
        }

        return $comment->load(['thread.document.currentVersion', 'thread.anchors']);
    }

    /**
     * One model call per budgeted chunk — in practice always exactly one, since
     * a comment is a single indivisible section.
     *
     * @param  list<string>  $chunks
     * @return array{list<array{title: string, fragment: string, quote: string}>, Coverage}
     */
    private function propose(AiRun $run, array $chunks, Coverage $coverage): array
    {
        $splits = [];

        foreach ($chunks as $chunk) {
            $response = CommentSplitAgent::make()->prompt($chunk);

            // Spend is recorded before the response is judged: a refusal or an
            // unusable shape was still billed.
            $model = $response->meta->model;
            $this->ledger->recordSpend(
                $run,
                $model,
                $this->costs->totalTokens($response->usage),
                $this->costs->cost($model, $response->usage),
            );

            $this->rejectRefusal($response);

            if (! $response instanceof StructuredAgentResponse) {
                throw new UnparseableOutputException('The split model returned unstructured output.');
            }

            $splits = array_merge($splits, $this->validated($response->toArray()));
        }

        $cap = max(1, (int) config('kedge.ai.max_splits', 6));

        if (count($splits) > $cap) {
            $dropped = count($splits) - $cap;
            $splits = array_slice($splits, 0, $cap);
            $coverage = $coverage->withNote(sprintf(
                'The model proposed more splits than this instance allows, so %d %s dropped.',
                $dropped,
                $dropped === 1 ? 'was' : 'were',
            ));
        }

        return [$splits, $coverage];
    }

    /**
     * Attach each proposal's anchor, computed from its quote against the live
     * projection. A quote that cannot be located yields a null anchor — the
     * proposal is still approvable, it just forks the way a manual fork does.
     *
     * @param  list<array{title: string, fragment: string, quote: string}>  $splits
     * @return array{list<array{title: string, fragment: string, anchor: array<string, mixed>|null}>, Coverage}
     */
    private function anchored(Comment $comment, array $splits, Coverage $coverage): array
    {
        $locator = SplitAnchorLocator::forThread(
            $comment->thread,
            $comment->thread->document->currentVersion,
        );

        $proposals = [];
        $unanchored = 0;

        foreach ($splits as $split) {
            $anchor = $locator?->locate($split['quote']);

            if ($anchor === null && $split['quote'] !== '') {
                $unanchored++;
            }

            $proposals[] = [
                'title' => $split['title'],
                'fragment' => $split['fragment'],
                'anchor' => $anchor,
            ];
        }

        if ($unanchored > 0) {
            $coverage = $coverage->withNote(sprintf(
                '%d proposed %s could not be matched to the document text, so %s the original selection.',
                $unanchored,
                $unanchored === 1 ? 'split' : 'splits',
                $unanchored === 1 ? 'it keeps' : 'they keep',
            ));
        }

        return [$proposals, $coverage];
    }

    /**
     * A content-policy stop is deterministic: the same comment will be refused
     * again, so the run fails at once rather than retrying into the same wall.
     */
    private function rejectRefusal(TextResponse $response): void
    {
        if ($response->steps->last()?->finishReason === FinishReason::ContentFilter) {
            throw new ContentRefusedException('The provider refused this content.');
        }
    }

    /**
     * Reduce the structured payload to exactly the shape the panel renders,
     * refusing anything else. The SDK has already parsed and retried by the time
     * we see this, so an unusable shape is deterministic.
     *
     * @param  array<string, mixed>  $structured
     * @return list<array{title: string, fragment: string, quote: string}>
     */
    private function validated(array $structured): array
    {
        $splits = $structured['splits'] ?? null;

        if (! is_array($splits)) {
            throw new UnparseableOutputException('The split model omitted the [splits] list.');
        }

        return array_values(array_map($this->entry(...), $splits));
    }

    /**
     * @return array{title: string, fragment: string, quote: string}
     */
    private function entry(mixed $entry): array
    {
        if (! is_array($entry)) {
            throw new UnparseableOutputException('The split model returned a malformed proposal.');
        }

        $title = is_string($entry['title'] ?? null) ? trim($entry['title']) : '';
        $fragment = is_string($entry['fragment'] ?? null) ? trim($entry['fragment']) : '';

        if ($title === '' || $fragment === '') {
            throw new UnparseableOutputException('The split model returned a proposal without a title or a fragment.');
        }

        return [
            'title' => Str::limit($title, self::MAX_TITLE_CHARS, '…'),
            'fragment' => Str::limit($fragment, self::MAX_FRAGMENT_CHARS, '… [fragment shortened]'),
            'quote' => is_string($entry['quote'] ?? null) ? $entry['quote'] : '',
        ];
    }
}
