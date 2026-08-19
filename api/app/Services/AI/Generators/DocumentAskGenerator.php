<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Services\AI\Agents\DocumentAskAgent;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Builders\DocumentAskPromptBuilder;
use App\Services\AI\Exceptions\IncompleteAiRequestException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\StructuredCall;

/**
 * Runs an ask-about-the-doc (SPEC §14, user story 23 — M4 #139): assemble the
 * document and the reader's question → one structured call → one answer.
 *
 * The whole feature's safety property is what is ABSENT from this file. There is
 * no comment written, no thread opened, no suggestion proposed, no anchor
 * persisted; the run's `output` is a string the panel renders and the reader can
 * copy. Hard rule 5 is satisfied here by construction rather than by discipline
 * — there is no write path to forget to guard.
 *
 * The question travels on the run itself (`ai_runs.request`), because only the
 * run id rides the queue. It is read back here and handed to the builder, which
 * fences it as untrusted data like everything else.
 */
class DocumentAskGenerator implements GeneratesAiRun
{
    public function __construct(
        private readonly DocumentAskPromptBuilder $builder,
        private readonly StructuredCall $call,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $run->loadMissing('document.currentVersion');

        $assembled = $this->builder->build($run->document, $this->question($run), $this->quote($run));

        // Scope first, model call second: a run that fails still says what it
        // was assembled from.
        $this->ledger->recordScope($run, $assembled->meta);

        $coverage = ['coverage' => $assembled->coverage->toArray()];

        // A document with no readable text has nothing to answer FROM. Saying so
        // is an honest completion, not an error, and it is not billed (G10's
        // rule applied to this type): a model asked to answer from nothing would
        // answer from its own background knowledge, which is the one thing this
        // agent must never do.
        if ($assembled->isEmpty()) {
            return new AiGeneration($coverage + [
                'answer' => 'This document has no readable text yet, so there is nothing to answer from.',
            ]);
        }

        // The model the LEDGER already committed to, not whatever config says
        // now — an AI_MODEL retune while this job sat in the queue must not bill
        // a model the pending row and `ai_run.started` never named.
        $structured = $this->call->invoke(
            $run,
            fn () => DocumentAskAgent::make()->prompt($assembled->chunks[0], model: $run->model),
        );

        return new AiGeneration($coverage + [
            'answer' => $this->call->requiredText($structured, 'answer'),
        ]);
    }

    /**
     * The reader's question, as they typed it.
     *
     * A run without one is a broken row rather than a question with no words:
     * the endpoint validates the question as required, so the only way to get
     * here is a hand-written row or a future caller that forgot. Failing
     * deterministically is right either way — a retry cannot invent the question.
     */
    private function question(AiRun $run): string
    {
        $question = $run->requestPayload()['question'] ?? null;

        if (! is_string($question) || trim($question) === '') {
            throw new IncompleteAiRequestException('An ask run must carry the question it was created for.');
        }

        return trim($question);
    }

    /**
     * The passage the reader had selected, or null for a doc-wide ask.
     *
     * @return array{exact?: string, heading_path?: array<int, string>}|null
     */
    private function quote(AiRun $run): ?array
    {
        $quote = $run->requestPayload()['quote'] ?? null;

        if (! is_array($quote)) {
            return null;
        }

        $exact = $quote['exact'] ?? null;

        if (! is_string($exact) || trim($exact) === '') {
            return null;
        }

        return [
            'exact' => $exact,
            'heading_path' => array_values(array_filter(
                (array) ($quote['heading_path'] ?? []),
                'is_string',
            )),
        ];
    }
}
