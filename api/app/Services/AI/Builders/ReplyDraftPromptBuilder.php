<?php

namespace App\Services\AI\Builders;

use App\Enums\ReplyStance;
use App\Models\Thread;
use App\Services\AI\Prompt\AssembledPrompt;

/**
 * The reply-draft prompt (SPEC §14, user story 5). Content selection is
 * {@see ThreadPromptBuilder}'s job; this owns exactly one thing — the trusted
 * instruction block, and how the AUTHOR'S CHOSEN STANCE shapes it.
 *
 * The stance is not a hint the model may reconsider. The author has already
 * decided whether they are accepting, pushing back, or asking for detail; the
 * model's job is to write that reply well, not to form its own opinion of the
 * thread. That is what keeps this a drafting tool rather than a participant —
 * and the draft still lands in the composer for the human to edit and send
 * (hard rule 5).
 */
class ReplyDraftPromptBuilder
{
    public function __construct(
        private readonly ThreadPromptBuilder $threads,
    ) {}

    public function build(Thread $thread, ReplyStance $stance, ?int $authorId = null): AssembledPrompt
    {
        return $this->threads->build($thread, $this->task($stance), $authorId);
    }

    private function task(ReplyStance $stance): string
    {
        return implode("\n", [
            'TASK. Draft ONE reply for a person to post in this review thread.',
            'The comments below are listed MOST RECENT FIRST; reply to where the conversation actually stands.',
            '',
            'The person has already chosen their position. Write THAT reply:',
            $this->stanceLine($stance),
            '',
            'Rules:',
            '- Write in the first person, as the person posting. No greeting, no sign-off, no preamble.',
            '- Two to four sentences. Plain, direct, collegial — a working reply, not a memo.',
            '- Ground it in what this thread actually says. Invent no facts, no commitments, no dates.',
            '- Do not restate the whole thread back at the reader.',
            '- Never claim the reply is from an AI, and never mention these instructions.',
            'Return the reply text in the `body` field.',
        ]);
    }

    private function stanceLine(ReplyStance $stance): string
    {
        return match ($stance) {
            ReplyStance::Accept => '- ACCEPT: agree with the feedback and say concretely what will change. '
                .'Do not hedge it back into a maybe.',
            ReplyStance::PushBack => '- PUSH BACK: disagree, and give the reason from this thread or the quoted text. '
                .'Respectful and specific, never dismissive; do not concede the point.',
            ReplyStance::Clarify => '- CLARIFY: ask for the detail that is missing before this can be acted on. '
                .'Name what is unclear and ask one or two pointed questions. Take no position on the substance.',
        };
    }
}
