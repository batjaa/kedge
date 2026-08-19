<?php

namespace App\Services\AI\Builders;

use App\Enums\CommentType;
use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Services\AI\Prompt\AssembledPrompt;
use App\Services\AI\Prompt\PromptAssembler;
use App\Services\AI\Prompt\PromptSection;
use App\Services\AI\Prompt\UntrustedFence;
use Illuminate\Support\Str;

/**
 * Selects what a review digest reads and shapes it into sections (SPEC §14.1,
 * user stories 1–3). Everything structural — fencing, budget math, chunking,
 * coverage — is delegated to {@see PromptAssembler}: this builder chooses
 * content, nothing else.
 *
 * One thread (with its comments and its anchor quote) is one section, so a chunk
 * boundary never splits a conversation, and coverage counts threads — the unit
 * the author thinks in ("covers 12 of 20 threads").
 *
 * Author display names are deliberately kept OUT of the prompt: they are
 * self-chosen text (another injection channel) and a digest of themes and
 * contention needs positions, not names. Comment authorship is carried as an
 * opaque participant id inside the fenced block.
 */
class DigestPromptBuilder
{
    /**
     * Share of the context budget the document body may occupy. Beyond it the
     * body is left out entirely and the prompt says so — the threads carry their
     * own quoted anchors, so the digest is still grounded in the text under
     * review.
     */
    private const BODY_BUDGET_SHARE = 0.25;

    /** Longest anchor quote carried into the prompt, before an explicit cut mark. */
    private const MAX_QUOTE_CHARS = 600;

    public function build(Document $document): AssembledPrompt
    {
        $assembler = PromptAssembler::forRun();
        $fence = $assembler->fence();

        // The context budget is the guard on what reaches the MODEL (spec,
        // §"Context budget"); this cap is the guard on what reaches worker
        // memory, so a pathological review can't hydrate itself into an OOM and
        // take the shared queue with it. The real total is counted separately,
        // so anything past the cap is reported as coverage, never hidden.
        $total = $document->threads()->count();
        $cap = max(1, (int) config('kedge.ai.max_threads', 500));

        // Trashed comments are excluded: a deleted comment is not part of the
        // review the author is being shown.
        $threads = $document->threads()
            ->with([
                'comments' => fn ($query) => $query->withoutTrashed()->oldest('id'),
                'anchors' => fn ($query) => $query->where('document_version_id', $document->current_version_id),
            ])
            ->oldest('id')
            ->limit($cap)
            ->get();

        $sections = $threads
            ->map(fn (Thread $thread): PromptSection => new PromptSection(
                label: 'thread-'.$thread->id,
                body: $fence->wrap('thread '.$thread->id, $this->threadBody($thread)),
            ))
            ->values()
            ->all();

        [$context, $bodyIncluded] = $this->context($document, $assembler, $fence);

        $assembled = $assembler->assemble(
            task: $this->task($bodyIncluded),
            sections: $sections,
            context: $context,
            totalUnits: $total,
            unit: 'threads',
        );

        $coverage = $assembled->coverage;

        // Own up to the omissions the thread count can't express, so the panel's
        // verbatim statement is the whole truth and not just the countable part.
        if (! $bodyIncluded) {
            $coverage = $coverage->withNote(
                'The document body was too large to include, so threads were read with their quoted anchors.',
            );
        }

        return new AssembledPrompt(
            chunks: $assembled->chunks,
            coverage: $coverage,
            meta: $assembled->meta + [
                'document_id' => $document->id,
                'document_version_id' => $document->current_version_id,
                'thread_ids' => $threads->pluck('id')->all(),
                'thread_total' => $total,
                'document_body_included' => $bodyIncluded,
            ],
        );
    }

    /**
     * The trusted instruction block. Never contains document or comment content.
     */
    private function task(bool $bodyIncluded): string
    {
        return implode("\n", array_filter([
            'TASK. You are summarizing a spec review for the document\'s author.',
            'From the review threads below, produce:',
            '- themes: the recurring subjects the review keeps returning to;',
            '- contention_points: where reviewers disagree, with both positions;',
            '- consensus: what reviewers agree on;',
            '- action_items: concrete changes the review asks the author to make.',
            'Every entry needs a short title and a one-or-two-sentence summary.',
            'Base every entry on what the threads actually say. Invent nothing.',
            'Return empty lists for categories the review does not support.',
            $bodyIncluded
                ? null
                : 'The document body is too large to include in this pass; work from each thread\'s quoted anchor.',
        ]));
    }

    /**
     * Document context repeated in every chunk: the title, and the body when it
     * fits the body share of the budget. Returns the fenced block and whether the
     * body made it in — never a silently truncated body.
     *
     * @return array{string, bool}
     */
    private function context(Document $document, PromptAssembler $assembler, UntrustedFence $fence): array
    {
        $body = (string) ($document->currentVersion?->plain_text ?? '');
        $allowance = (int) floor($assembler->budget()->maxTokens * self::BODY_BUDGET_SHARE);
        $included = $body !== '' && $assembler->budget()->estimate($body) <= $allowance;

        $lines = ['document title: '.$document->title];

        if ($included) {
            $lines[] = '';
            $lines[] = 'document body:';
            $lines[] = $body;
        }

        return [
            $fence->wrap('document '.$document->id, implode("\n", $lines)),
            $included,
        ];
    }

    /**
     * One thread rendered as plain lines. The caller fences the whole block, so
     * everything here — anchor quotes, comment bodies, proposed replacements — is
     * inside the fence and labeled as data.
     */
    private function threadBody(Thread $thread): string
    {
        $lines = [
            'thread id: '.$thread->id,
            'status: '.$thread->status->value,
            'type: '.$thread->type->value,
        ];

        $anchor = $thread->anchors->first();

        if ($anchor instanceof Anchor) {
            $section = is_array($anchor->heading_path) ? implode(' > ', $anchor->heading_path) : null;

            if ($section !== null && $section !== '') {
                $lines[] = 'document section: '.$section;
            }

            // An over-long quote is shortened with the cut MARKED, so the model
            // is never handed a silently amputated sentence to reason from.
            $lines[] = 'quoted from the document: '
                .Str::limit((string) $anchor->exact, self::MAX_QUOTE_CHARS, '… [quote shortened]');
        }

        foreach ($thread->comments as $comment) {
            $lines[] = '';
            $lines[] = $this->commentHeading($comment);
            $lines[] = (string) $comment->body_md;

            if ($comment->type === CommentType::Suggestion && $comment->proposed_text !== null) {
                $lines[] = 'proposed replacement text:';
                $lines[] = (string) $comment->proposed_text;
            }
        }

        return implode("\n", $lines);
    }

    private function commentHeading(Comment $comment): string
    {
        $parts = ['comment '.$comment->id, 'participant '.$comment->author_id, $comment->type->value];

        if ($comment->suggestion_status !== null) {
            $parts[] = 'suggestion '.$comment->suggestion_status->value;
        }

        return '['.implode(', ', $parts).']';
    }
}
