<?php

namespace App\Services\AI\Prompt;

/**
 * The output of the shared assembly foundation: the prompt text for each model
 * call this run will make, plus the coverage that describes what those calls
 * actually see, plus the metadata the ledger stores in `ai_runs.input`.
 *
 * `chunks` is empty when there was nothing to send — a document with no review
 * threads. The generator completes such a run with an honest empty output rather
 * than paying for a model call that has nothing to read (G10).
 */
final class AssembledPrompt
{
    /**
     * @param  list<string>  $chunks
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public readonly array $chunks,
        public readonly Coverage $coverage,
        public readonly array $meta = [],
    ) {}

    public function isEmpty(): bool
    {
        return $this->chunks === [];
    }
}
