<?php

namespace App\Services\AI\Builders;

use App\Enums\CommentType;
use App\Enums\ThreadType;
use App\Models\Anchor;
use App\Models\Comment;
use App\Services\AI\Prompt\AssembledPrompt;
use App\Services\AI\Prompt\PromptAssembler;
use App\Services\AI\Prompt\PromptSection;
use Illuminate\Support\Str;

/**
 * Selects what a comment-split proposal reads (SPEC §14, user story 6).
 * Everything structural — fencing, budget math, chunking, coverage — is
 * delegated to {@see PromptAssembler}: this builder chooses content, nothing
 * else, exactly as the digest builder does.
 *
 * The unit is ONE comment, so there is exactly one section and a split is
 * always a single model call. A comment too large for the budget is left out
 * whole and reported as coverage rather than truncated — a split proposed from
 * half a comment would quietly mis-divide it.
 *
 * The document passage is the source thread's anchored text, and it is the ONLY
 * place a proposed anchor may come from: a split of a thread stays inside the
 * span that thread is about. A document-level thread has no passage, so it gets
 * no quotes at all — which matches the fork endpoint, where only inline threads
 * may carry a client anchor.
 *
 * Author display names are kept OUT, as in the digest: self-chosen text is
 * another injection channel, and dividing a comment needs its issues, not who
 * wrote it.
 */
class CommentSplitPromptBuilder
{
    /** Longest document passage carried into the prompt, before an explicit cut mark. */
    private const MAX_PASSAGE_CHARS = 4000;

    public function build(Comment $comment): AssembledPrompt
    {
        $comment->loadMissing(['thread.document.currentVersion', 'thread.anchors']);

        $thread = $comment->thread;
        $assembler = PromptAssembler::forRun();
        $fence = $assembler->fence();

        $passage = $this->passage($comment);

        $section = new PromptSection(
            label: 'comment-'.$comment->id,
            body: $fence->wrap('comment '.$comment->id, $this->commentBody($comment)),
        );

        $context = $fence->wrap('document passage', implode("\n", array_filter([
            'document title: '.$thread->document->title,
            $passage === null ? 'document passage: (none — this is a document-level thread)' : 'document passage:',
            $passage,
        ], fn (?string $line): bool => $line !== null)));

        $assembled = $assembler->assemble(
            task: $this->task($passage !== null),
            sections: [$section],
            context: $context,
            totalUnits: 1,
            unit: 'comments',
        );

        return new AssembledPrompt(
            chunks: $assembled->chunks,
            coverage: $assembled->coverage,
            meta: $assembled->meta + [
                'document_id' => $thread->document_id,
                'document_version_id' => $thread->document->current_version_id,
                'thread_id' => $thread->id,
                'comment_id' => $comment->id,
                'passage_included' => $passage !== null,
            ],
        );
    }

    /**
     * The trusted instruction block. Never contains document or comment content.
     */
    private function task(bool $hasPassage): string
    {
        return implode("\n", array_filter([
            'TASK. You are dividing ONE review comment into separate review threads for the document\'s author.',
            'Read the comment below and decide whether it raises several distinct issues.',
            'For each distinct issue return:',
            '- title: a short name for the thread that issue would become;',
            '- fragment: the part of the comment that raises it, quoted verbatim from the comment;',
            $hasPassage
                ? '- quote: the words from the quoted document passage that the issue is about, copied EXACTLY '
                    .'character for character from the passage, or an empty string if the passage does not cover it.'
                : '- quote: always an empty string — this comment is not attached to a document passage.',
            'Return an EMPTY list when the comment raises only one issue: not every comment needs splitting.',
            'Cover the comment without overlapping — every fragment comes from the comment, none is invented.',
            'Never write a fragment or a quote that does not appear in the material below.',
        ]));
    }

    /**
     * The passage a proposed anchor may point into: the source thread's anchored
     * text on the current version. Null when there is none to point into.
     */
    private function passage(Comment $comment): ?string
    {
        if ($comment->thread->type !== ThreadType::Inline) {
            return null;
        }

        $anchor = $comment->thread->anchors
            ->firstWhere('document_version_id', $comment->thread->document->current_version_id)
            ?? $comment->thread->anchors->last();

        if (! $anchor instanceof Anchor) {
            return null;
        }

        $exact = (string) $anchor->exact;

        // An over-long passage is shortened with the cut MARKED, and the
        // generator only accepts quotes it can still find in the live
        // projection — so a quote from a cut-off tail simply yields no anchor
        // rather than a wrong one.
        return $exact === ''
            ? null
            : Str::limit($exact, self::MAX_PASSAGE_CHARS, '… [passage shortened]');
    }

    /**
     * The comment rendered as plain lines. The caller fences the whole block, so
     * the body and any proposed replacement are inside the fence and labeled as
     * data.
     */
    private function commentBody(Comment $comment): string
    {
        $lines = [
            'comment id: '.$comment->id,
            'type: '.$comment->type->value,
            '',
            (string) $comment->body_md,
        ];

        if ($comment->type === CommentType::Suggestion && $comment->proposed_text !== null) {
            $lines[] = '';
            $lines[] = 'proposed replacement text:';
            $lines[] = (string) $comment->proposed_text;
        }

        return implode("\n", $lines);
    }
}
