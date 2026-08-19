<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\AiCostCalculator;
use App\Services\AI\AiGeneration;
use App\Services\AI\Builders\DigestPromptBuilder;
use App\Services\AI\Exceptions\UnparseableOutputException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\Prompt\AssembledPrompt;
use Laravel\Ai\Responses\Data\Usage;
use Laravel\Ai\Responses\StructuredAgentResponse;

/**
 * Runs the review digest (SPEC §14.1, user stories 1–3): assemble → one
 * structured call per budgeted chunk → merge → attach coverage.
 *
 * Two invariants live here:
 *
 *  - A document with no threads NEVER calls the model. It completes with an
 *    honest empty digest and a coverage line that says there was nothing to
 *    read (G10) — an empty review is not an error, and it should not be billed.
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
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $run->loadMissing('document.currentVersion');

        $assembled = $this->builder->build($run->document);

        if ($assembled->isEmpty()) {
            return new AiGeneration(
                output: $this->emptyOutput() + ['coverage' => $assembled->coverage->toArray()],
                model: $run->model,
                tokens: 0,
                cost: 0.0,
                meta: $assembled->meta,
            );
        }

        return $this->promptChunks($assembled);
    }

    private function promptChunks(AssembledPrompt $assembled): AiGeneration
    {
        $merged = $this->emptyOutput();
        $usage = new Usage;
        $model = null;

        foreach ($assembled->chunks as $chunk) {
            $response = ReviewDigestAgent::make()->prompt($chunk);

            if (! $response instanceof StructuredAgentResponse) {
                throw new UnparseableOutputException(
                    'The digest model returned unstructured output.',
                );
            }

            $usage = $usage->add($response->usage);
            $model = $response->meta->model ?? $model;

            foreach ($this->validated($response->toArray()) as $category => $entries) {
                $merged[$category] = array_merge($merged[$category], $entries);
            }
        }

        return new AiGeneration(
            output: $merged + ['coverage' => $assembled->coverage->toArray()],
            model: $model,
            tokens: $this->costs->totalTokens($usage),
            cost: $this->costs->cost($model, $usage),
            meta: $assembled->meta,
        );
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
