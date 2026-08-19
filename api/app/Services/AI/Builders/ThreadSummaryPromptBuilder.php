<?php

namespace App\Services\AI\Builders;

use App\Models\Thread;
use App\Services\AI\Prompt\AssembledPrompt;

/**
 * The thread-summary prompt (SPEC §14, user story 7): what a forty-reply thread
 * currently amounts to, and what it is still waiting on.
 *
 * Two fields, deliberately — "current state" and "the open question" — because
 * that is the whole job. A reviewer joining late does not need a précis of every
 * turn; they need to know where the argument landed and what is still being
 * asked. A summary that reads like minutes has failed.
 *
 * Content selection (newest-first, one call, honest coverage) is
 * {@see ThreadPromptBuilder}'s.
 */
class ThreadSummaryPromptBuilder
{
    public function __construct(
        private readonly ThreadPromptBuilder $threads,
    ) {}

    public function build(Thread $thread): AssembledPrompt
    {
        return $this->threads->build($thread, $this->task());
    }

    private function task(): string
    {
        return implode("\n", [
            'TASK. Summarize this review thread for someone about to join it.',
            'The comments below are listed MOST RECENT FIRST.',
            '',
            'Produce exactly two things:',
            '- current_state: where the discussion stands now — what was proposed, what was agreed, '
                .'what was rejected, and any position still being argued. Two to four sentences.',
            '- open_question: the single thing this thread is still waiting on, as one sentence. '
                .'If the thread has settled and nothing is outstanding, say so plainly in that field.',
            '',
            'Rules:',
            '- Report only what the comments say. Invent nothing, and take no side.',
            '- Do not recap turn by turn, and do not name participants.',
            '- No preamble and no headings — just the two fields.',
        ]);
    }
}
