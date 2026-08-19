<?php

namespace App\Services\AI\Generators;

use App\Models\AiRun;
use App\Models\Thread;
use App\Services\AI\Agents\ThreadSummaryAgent;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Builders\ThreadSummaryPromptBuilder;
use App\Services\AI\Exceptions\UnsupportedAiRunTypeException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\StructuredCall;

/**
 * Runs a thread summary (SPEC §14, user story 7): assemble the thread → one
 * structured call on the cheap model → current state plus the open question.
 *
 * A summary is a reading aid and nothing more. It changes no thread state, marks
 * nothing resolved, and is not stored on the thread — it is a run the reviewer
 * reads (hard rule 5).
 */
class ThreadSummaryGenerator implements GeneratesAiRun
{
    public function __construct(
        private readonly ThreadSummaryPromptBuilder $builder,
        private readonly StructuredCall $call,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $assembled = $this->builder->build($this->thread($run));

        $this->ledger->recordScope($run, $assembled->meta);

        $coverage = ['coverage' => $assembled->coverage->toArray()];

        // Nothing readable fit the budget. An honest empty summary with its
        // coverage line, never a fabricated one and never an error (G10's rule).
        if ($assembled->isEmpty()) {
            return new AiGeneration($coverage + ['current_state' => '', 'open_question' => '']);
        }

        $structured = $this->call->invoke(
            $run,
            fn () => ThreadSummaryAgent::make()->prompt($assembled->chunks[0]),
        );

        return new AiGeneration($coverage + [
            'current_state' => $this->call->requiredText($structured, 'current_state'),
            'open_question' => $this->call->requiredText($structured, 'open_question'),
        ]);
    }

    private function thread(AiRun $run): Thread
    {
        $run->loadMissing('target');
        $thread = $run->target;

        if (! $thread instanceof Thread) {
            throw new UnsupportedAiRunTypeException('A thread summary run must target a thread.');
        }

        return $thread;
    }
}
