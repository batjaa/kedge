<?php

namespace App\Services\AI\Builders;

use App\Enums\CommentType;
use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Thread;
use App\Services\AI\Prompt\AssembledPrompt;
use App\Services\AI\Prompt\ContextBudget;
use App\Services\AI\Prompt\PromptAssembler;
use App\Services\AI\Prompt\PromptSection;
use App\Services\AI\Prompt\UntrustedFence;
use Illuminate\Support\Str;

/**
 * What the two thread-scoped triage builders (reply draft, thread summary) read.
 * Everything structural — fencing, budget math, coverage accounting — is
 * delegated to {@see PromptAssembler}; this selects content and nothing else.
 *
 * Two decisions shape it, and they are the reason a thread builder is not just
 * the digest builder with a `where`:
 *
 *  - **One comment is one section.** Coverage counts comments, because that is
 *    the unit a reviewer thinks in on a forty-reply thread, and a cut between
 *    comments never shows the model half a sentence.
 *  - **Exactly one model call, over the MOST RECENT comments.** A reply and a
 *    summary are single-voice outputs: merging two chunks would produce two
 *    drafts, not one. So the budget is pinned to a single chunk and the sections
 *    are ordered NEWEST FIRST, which makes the assembler's overflow rule ("what
 *    doesn't fit is coverage, never silence") drop the oldest, most stale
 *    material rather than the current state of the conversation. The ordering is
 *    stated to the model in the task, and whatever was dropped is stated to the
 *    user in the coverage line.
 *
 * Author display names stay OUT of the prompt (they are self-chosen text, i.e. an
 * injection channel); authorship rides as an opaque participant id, and the
 * viewer's own id is named so the draft knows which voice it is writing in.
 */
class ThreadPromptBuilder
{
    /** Longest anchor quote carried into the prompt, before an explicit cut mark. */
    private const MAX_QUOTE_CHARS = 600;

    /**
     * Assemble one thread for a single-call generation.
     *
     * @param  string  $task  Trusted instructions — never document or comment content.
     * @param  int|null  $authorId  The participant the output is written FOR, so the
     *                              prompt can say "you are participant N" without
     *                              ever carrying a display name.
     */
    public function build(Thread $thread, string $task, ?int $authorId = null): AssembledPrompt
    {
        // One chunk, always: see the class docblock. The token ceiling stays the
        // configured one, so a retuned budget still applies.
        $assembler = PromptAssembler::forRun(new ContextBudget(
            maxTokens: max(1, (int) config('kedge.ai.context_tokens', 24000)),
            maxChunks: 1,
        ));
        $fence = $assembler->fence();

        $thread->loadMissing('document');

        // The worker-memory cap (the digest's guard, same reasoning): coverage
        // still counts against the thread's REAL comment total, so exceeding it
        // is reported rather than hidden.
        $total = $thread->comments()->withoutTrashed()->count();
        $cap = max(1, (int) config('kedge.ai.max_threads', 500));

        // Trashed comments are excluded: a deleted comment is not part of the
        // conversation anyone is replying to. Newest first — the assembler keeps
        // what fits from the front, and the front is what matters here.
        $comments = $thread->comments()
            ->withoutTrashed()
            ->latest('id')
            ->limit($cap)
            ->get();

        $sections = $comments
            ->map(fn (Comment $comment): PromptSection => new PromptSection(
                label: 'comment-'.$comment->id,
                body: $fence->wrap('comment '.$comment->id, $this->commentBody($comment)),
            ))
            ->values()
            ->all();

        $assembled = $assembler->assemble(
            task: $task,
            sections: $sections,
            context: $this->context($thread, $fence, $authorId),
            totalUnits: $total,
            unit: 'comments',
        );

        $coverage = $assembled->coverage;

        if ($coverage->isPartial()) {
            $coverage = $coverage->withNote($this->omissionNote($sections, $assembled->meta));
        }

        return new AssembledPrompt(
            chunks: $assembled->chunks,
            coverage: $coverage,
            meta: $assembled->meta + [
                'document_id' => $thread->document_id,
                'document_version_id' => $thread->document?->current_version_id,
                'thread_id' => $thread->id,
                'comment_ids' => $comments->pluck('id')->all(),
                'comment_total' => $total,
            ],
        );
    }

    /**
     * What to confess about the comments that did not make it in.
     *
     * Newest-first ordering means the usual omission is a tail of old material,
     * and saying so is genuinely useful. But the assembler also drops a section
     * too large for ANY single call and carries on — so a single enormous latest
     * comment can be skipped while older ones are read, and a blanket "the most
     * recent comments were read" would then be a lie, about the one comment a
     * reply or a summary most needs. Coverage that isn't true is worse than no
     * coverage at all (SPEC §14), so the newest comment's fate is checked rather
     * than assumed.
     *
     * @param  list<PromptSection>  $sections  Newest first.
     * @param  array<string, mixed>  $meta
     */
    private function omissionNote(array $sections, array $meta): string
    {
        $skipped = $meta['skipped_sections'] ?? [];
        $newestSkipped = $sections !== []
            && is_array($skipped)
            && in_array($sections[0]->label, $skipped, true);

        return $newestSkipped
            ? 'The most recent comment was too large to include, so it was left out.'
            : 'The most recent comments were read; the rest were left out.';
    }

    /**
     * The thread's own framing, fenced and repeated in the (single) chunk: what
     * the document is, what text the thread hangs off, and who the output is for.
     */
    private function context(Thread $thread, UntrustedFence $fence, ?int $authorId): string
    {
        $lines = [
            'document title: '.($thread->document?->title ?? 'Untitled'),
            'thread id: '.$thread->id,
            'thread status: '.$thread->status->value,
            'thread type: '.$thread->type->value,
        ];

        if ($authorId !== null) {
            $lines[] = 'you are writing as participant '.$authorId;
        }

        $anchor = $thread->anchors()
            ->where('document_version_id', $thread->document?->current_version_id)
            ->first();

        if ($anchor instanceof Anchor) {
            $section = is_array($anchor->heading_path) ? implode(' > ', $anchor->heading_path) : null;

            if ($section !== null && $section !== '') {
                $lines[] = 'document section: '.$section;
            }

            // An over-long quote is shortened with the cut MARKED, so the model is
            // never handed a silently amputated sentence to reason from.
            $lines[] = 'quoted from the document: '
                .Str::limit((string) $anchor->exact, self::MAX_QUOTE_CHARS, '… [quote shortened]');
        }

        return $fence->wrap('thread '.$thread->id, implode("\n", $lines));
    }

    /**
     * One comment as plain lines. The caller fences the whole block, so the body
     * and any proposed replacement are inside the fence and labeled as data.
     */
    private function commentBody(Comment $comment): string
    {
        $lines = [$this->heading($comment), (string) $comment->body_md];

        if ($comment->type === CommentType::Suggestion && $comment->proposed_text !== null) {
            $lines[] = 'proposed replacement text:';
            $lines[] = (string) $comment->proposed_text;
        }

        return implode("\n", $lines);
    }

    private function heading(Comment $comment): string
    {
        $parts = ['comment '.$comment->id, 'participant '.$comment->author_id, $comment->type->value];

        if ($comment->suggestion_status !== null) {
            $parts[] = 'suggestion '.$comment->suggestion_status->value;
        }

        // Whether a comment came from a human or an agent over MCP is part of
        // the conversation's meaning, and it is ours to state — never the
        // content's to claim.
        $parts[] = 'via '.$comment->client->value;

        return '['.implode(', ', $parts).']';
    }
}
