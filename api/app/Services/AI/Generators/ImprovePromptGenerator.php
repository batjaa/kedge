<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Services\AI\Agents\ImprovePromptAgent;
use App\Services\AI\AiCostCalculator;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Artifacts\ImprovePromptPlan;
use App\Services\AI\Builders\ImprovePromptBuilder;
use App\Services\AI\Exceptions\ContentRefusedException;
use App\Services\AI\Exceptions\UnparseableOutputException;
use App\Services\AI\GeneratesAiRun;
use Laravel\Ai\Responses\Data\FinishReason;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Laravel\Ai\Responses\TextResponse;
use Throwable;

/**
 * Runs the improve-the-doc prompt (SPEC §14, user story 4): assemble → one
 * structured call per budgeted chunk → collect per-thread instructions → render
 * the artifact from the DATABASE, with the model's sentences dropped into it.
 *
 * The ledger contract is the digest's, unchanged: scope written before any call,
 * spend recorded per call as it is incurred, deterministic output problems
 * failing at once rather than retrying into the same wall.
 *
 * Three invariants live here:
 *
 *  - A document with no unresolved feedback NEVER calls the model. It completes
 *    with an honest empty artifact and a coverage line saying there was nothing
 *    to work from — an empty review is not an error, and should not be billed.
 *  - An instruction for a thread this run did not send is DISCARDED. Model output
 *    is untrusted: an invented id must not be able to attach a stranger's
 *    sentence to a real thread's quoted anchor.
 *  - Accepted suggested edits never pass through the model's output — the plan
 *    splices them in verbatim, so "verbatim" is a property of the code.
 */
class ImprovePromptGenerator implements GeneratesAiRun
{
    public function __construct(
        private readonly ImprovePromptBuilder $builder,
        private readonly AiCostCalculator $costs,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $run->loadMissing('document.currentVersion');

        $plan = $this->builder->build($run->document);

        // Scope first, model calls second: a run that fails still says what it
        // was assembled from.
        $this->ledger->recordScope($run, $plan->meta());

        // Nothing to send is not the same as nothing to say: a review whose only
        // unresolved thread is too large to read still owes the author its
        // accepted edits, which need no model at all.
        $instructions = $plan->hasChunks() ? $this->instructions($run, $plan) : [];

        return new AiGeneration($this->output($plan, $plan->toArtifact($instructions)));
    }

    /**
     * One structured call per chunk, merged into a thread_id → instruction map.
     * The FIRST answer for a thread wins: a later chunk cannot overwrite an
     * instruction the run already has.
     *
     * @return array<int, string>
     */
    private function instructions(AiRun $run, ImprovePromptPlan $plan): array
    {
        $instructions = [];

        foreach ($plan->chunks() as $chunk) {
            try {
                $response = ImprovePromptAgent::make()->prompt($chunk);
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
                throw new UnparseableOutputException('The improve-prompt model returned unstructured output.');
            }

            foreach ($this->validated($response->toArray()) as $threadId => $instruction) {
                if (! isset($instructions[$threadId]) && $plan->covers($threadId)) {
                    $instructions[$threadId] = $instruction;
                }
            }
        }

        return $instructions;
    }

    /**
     * A content-policy stop is deterministic: the same document and comments will
     * be refused again, so the run fails at once with a specific error rather
     * than retrying three times into the same wall.
     */
    private function rejectRefusal(TextResponse $response): void
    {
        if ($response->steps->last()?->finishReason === FinishReason::ContentFilter) {
            throw new ContentRefusedException('The provider refused this content.');
        }
    }

    /**
     * Reduce one chunk's structured payload to thread_id → instruction, refusing
     * anything else. The SDK has already parsed and retried by the time we see
     * this, so a shape we cannot use will not become usable on a fourth attempt.
     *
     * @param  array<string, mixed>  $structured
     * @return array<int, string>
     */
    private function validated(array $structured): array
    {
        $changes = $structured['changes'] ?? null;

        if (! is_array($changes)) {
            throw new UnparseableOutputException('The improve-prompt model omitted the [changes] list.');
        }

        $instructions = [];

        foreach ($changes as $change) {
            if (! is_array($change)
                || ! is_string($change['instruction'] ?? null)
                || ! is_numeric($change['thread_id'] ?? null)) {
                throw new UnparseableOutputException('The improve-prompt model returned a malformed change.');
            }

            $instructions[(int) $change['thread_id']] = $change['instruction'];
        }

        return $instructions;
    }

    /**
     * The stored run output. `prompt` is the whole copyable artifact; the counts
     * are what the panel summarizes above it, and `coverage.statement` is the
     * sentence it renders verbatim.
     *
     * @return array<string, mixed>
     */
    private function output(ImprovePromptPlan $plan, string $artifact): array
    {
        return [
            'prompt' => $artifact,
            'required_edits' => $plan->requiredEditCount(),
            'threads' => count($plan->threads),
            'coverage' => $plan->coverage()->toArray(),
        ];
    }
}
