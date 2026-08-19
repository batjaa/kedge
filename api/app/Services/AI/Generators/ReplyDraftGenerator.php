<?php

namespace App\Services\AI\Generators;

use App\Enums\ReplyStance;
use App\Models\AiRun;
use App\Models\Thread;
use App\Services\AI\Agents\ReplyDraftAgent;
use App\Services\AI\AiGeneration;
use App\Services\AI\AiRunLedger;
use App\Services\AI\Builders\ReplyDraftPromptBuilder;
use App\Services\AI\Exceptions\UnsupportedAiRunTypeException;
use App\Services\AI\GeneratesAiRun;
use App\Services\AI\StructuredCall;

/**
 * Runs a per-thread reply draft (SPEC §14, user story 5): assemble the thread →
 * one structured call in the author's chosen stance → hand back editable text.
 *
 * What it deliberately does NOT do is post anything. The output is a string that
 * the web drops into the composer; the review write is the human's own submit,
 * through the same authorized endpoint as a hand-typed reply (hard rule 5). There
 * is no code path from here to a comment row, and there must never be one.
 *
 * The stance rides on the run as `variant` rather than being re-derived here, so
 * the row itself records which reply was asked for — a completed run is auditable
 * without re-reading the prompt.
 */
class ReplyDraftGenerator implements GeneratesAiRun
{
    public function __construct(
        private readonly ReplyDraftPromptBuilder $builder,
        private readonly StructuredCall $call,
        private readonly AiRunLedger $ledger,
    ) {}

    public function generate(AiRun $run): AiGeneration
    {
        $thread = $this->thread($run);
        $stance = ReplyStance::tryFrom((string) $run->variant);

        if ($stance === null) {
            // An unwired or corrupted stance is a deploy/data mistake, not a
            // blip: fail deterministically rather than guessing a position on
            // the author's behalf.
            throw new UnsupportedAiRunTypeException(
                'A reply draft run carries no valid stance ['.(string) $run->variant.'].',
            );
        }

        $assembled = $this->builder->build($thread, $stance, $run->created_by);

        // Scope first, model call second: a run that fails still says what it
        // was assembled from.
        $this->ledger->recordScope($run, $assembled->meta + ['stance' => $stance->value]);

        $base = [
            'stance' => $stance->value,
            'coverage' => $assembled->coverage->toArray(),
        ];

        // Nothing readable fit the budget — a real possibility on a thread of
        // enormous comments. Completing with an empty draft and an honest
        // coverage line beats both a fabricated reply and a failure the author
        // can only retry into (G10's rule, applied here).
        if ($assembled->isEmpty()) {
            return new AiGeneration($base + ['body' => '']);
        }

        $structured = $this->call->invoke(
            $run,
            fn () => ReplyDraftAgent::make()->prompt($assembled->chunks[0]),
        );

        return new AiGeneration($base + ['body' => $this->call->requiredText($structured, 'body')]);
    }

    private function thread(AiRun $run): Thread
    {
        $run->loadMissing('target');
        $thread = $run->target;

        if (! $thread instanceof Thread) {
            throw new UnsupportedAiRunTypeException('A reply draft run must target a thread.');
        }

        return $thread;
    }
}
