<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\AiCostCalculator;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Builders\DigestPromptBuilder;
use App\Services\AI\Exceptions\ContentRefusedException;
use App\Services\AI\Exceptions\UnparseableOutputException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\Prompt\AssembledPrompt;
use Laravel\Ai\Responses\Data\FinishReason;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Laravel\Ai\Responses\TextResponse;
use Throwable;

/**
 * Runs the review digest (SPEC §14.1, user stories 1–3): assemble → one
 * structured call per budgeted chunk → merge → attach coverage.
 *
 * Three invariants live here:
 *
 *  - A document with no threads NEVER calls the model. It completes with an
 *    honest empty digest and a coverage line that says there was nothing to
 *    read (G10) — an empty review is not an error, and it should not be billed.
 *  - Every model call's spend is written to the ledger AS IT HAPPENS, before the
 *    next chunk runs. A run that dies on chunk three still reports what chunks
 *    one and two cost.
 *  - Output the digest cannot use is a DETERMINISTIC failure. The SDK has
 *    already parsed and retried by the time we see it, so a shape we can't
 *    render will not become renderable on a fourth attempt.
 */
class ReviewDigestGenerator implements GeneratesAiRun
{
    /** The four lists the digest panel renders, in render order. */
    private const CATEGORIES = ['themes', 'contention_points', 'consensus', 'action_items'];

    public function __construct(
        private readonly DigestPromptBuilder $builder,
        private readonly AiCostCalculator $costs,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $run->loadMissing('document.currentVersion');

        $assembled = $this->builder->build($run->document);

        // Scope first, model calls second: a run that fails still says what it
        // was assembled from.
        $this->ledger->recordScope($run, $assembled->meta);

        if ($assembled->isEmpty()) {
            return new AiGeneration($this->emptyOutput() + ['coverage' => $assembled->coverage->toArray()]);
        }

        return $this->promptChunks($run, $assembled);
    }

    private function promptChunks(AiRun $run, AssembledPrompt $assembled): AiGeneration
    {
        $merged = $this->emptyOutput();

        foreach ($assembled->chunks as $chunk) {
            try {
                // The model the LEDGER already committed to, not whatever config
                // says now: an AI_MODEL retune while this job sat in the queue must
                // not bill a model the pending row and `ai_run.started` never named.
                $response = ReviewDigestAgent::make()->prompt($chunk, model: $run->model);
            } catch (Throwable $e) {
                // The request was issued; the provider may have accepted and
                // billed it before this died. We cannot say what it cost, so the
                // run's cost becomes unknown rather than a confident understatement.
                $this->ledger->markSpendUnknown($run);

                throw $e;
            }

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
                throw new UnparseableOutputException('The digest model returned unstructured output.');
            }

            foreach ($this->validated($response->toArray()) as $category => $entries) {
                $merged[$category] = array_merge($merged[$category], $entries);
            }
        }

        return new AiGeneration($merged + ['coverage' => $assembled->coverage->toArray()]);
    }

    /**
     * A content-policy stop is deterministic: the same document and comments
     * will be refused again, so the run fails at once with a specific error
     * rather than retrying three times into the same wall.
     */
    private function rejectRefusal(TextResponse $response): void
    {
        if ($response->steps->last()?->finishReason === FinishReason::ContentFilter) {
            throw new ContentRefusedException('The provider refused this content.');
        }
    }

    /**
     * @return array<string, list<array{title: string, summary: string}>>
     */
    private function emptyOutput(): array
    {
        return array_fill_keys(self::CATEGORIES, []);
    }

    /**
     * Reduce one chunk's structured payload to exactly the shape the panel
     * renders, refusing anything else.
     *
     * @param  array<string, mixed>  $structured
     * @return array<string, list<array{title: string, summary: string}>>
     */
    private function validated(array $structured): array
    {
        $result = [];

        foreach (self::CATEGORIES as $category) {
            $entries = $structured[$category] ?? null;

            if (! is_array($entries)) {
                throw new UnparseableOutputException(
                    'The digest model omitted the ['.$category.'] list.',
                );
            }

            $result[$category] = array_values(array_map(
                fn (mixed $entry): array => $this->entry($category, $entry),
                $entries,
            ));
        }

        return $result;
    }

    /**
     * @return array{title: string, summary: string}
     */
    private function entry(string $category, mixed $entry): array
    {
        if (! is_array($entry) || ! is_string($entry['title'] ?? null) || ! is_string($entry['summary'] ?? null)) {
            throw new UnparseableOutputException(
                'The digest model returned a malformed ['.$category.'] entry.',
            );
        }

        return [
            'title' => $entry['title'],
            'summary' => $entry['summary'],
        ];
    }
}
