<?php

namespace App\Services\AI\Builders;

use App\Enums\CommentType;
use App\Enums\SuggestionStatus;
use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Services\AI\Artifacts\ImprovePromptPlan;
use App\Services\AI\Artifacts\ThreadBrief;
use App\Services\AI\Prompt\AssembledPrompt;
use App\Services\AI\Prompt\PromptAssembler;
use App\Services\AI\Prompt\PromptSection;
use App\Services\AI\Prompt\UntrustedFence;
use Illuminate\Support\Str;

/**
 * Selects what the improve-the-doc prompt reads (SPEC §14, user story 4).
 * Everything structural — fencing, budget math, chunking, coverage — is
 * delegated to {@see PromptAssembler}; this builder chooses content and hands
 * the artifact's facts on in an {@see ImprovePromptPlan}.
 *
 * What is IN, and why:
 *
 *  - **Open threads only.** A resolved thread is a conversation the author has
 *    already closed; asking a coding agent to reopen it is exactly the noise
 *    this feature exists to remove.
 *  - **Declined suggestions are dropped entirely** — proposal and discussion
 *    alike. "Declined" is the author saying no; it must not reach the agent as
 *    an edit to make, and it must not reach the model as feedback to summarize.
 *  - **Accepted suggestions travel verbatim**, in the prompt and (via the plan)
 *    in the artifact, labeled as edits the model must not restate.
 *
 * One thread is one section, so a chunk boundary never splits a conversation and
 * coverage counts the unit the author thinks in ("covers 8 of 12 open threads").
 *
 * Author display names stay OUT of the prompt (self-chosen text is another
 * injection channel); comment authorship travels as an opaque participant id.
 */
class ImprovePromptBuilder
{
    /**
     * Share of the context budget the document body may occupy. Past it the body
     * is left out WHOLE and the coverage line says so — each thread carries its
     * own quoted anchor, so the instructions stay grounded either way.
     */
    private const BODY_BUDGET_SHARE = 0.25;

    /** Longest anchor quote carried into the PROMPT, before an explicit cut mark. */
    private const MAX_QUOTE_CHARS = 600;

    public function build(Document $document): ImprovePromptPlan
    {
        $assembler = PromptAssembler::forRun();
        $fence = $assembler->fence();

        // The context budget guards what reaches the MODEL; this cap guards what
        // reaches worker memory, so a pathological review cannot hydrate itself
        // into an OOM. Anything past it is still counted in the total, and so is
        // reported as coverage rather than hidden.
        $cap = max(1, (int) config('kedge.ai.max_threads', 500));

        $threads = $document->threads()
            ->open()
            ->with([
                'comments' => fn ($query) => $query->withoutTrashed()->oldest('id'),
                'anchors' => fn ($query) => $query->where('document_version_id', $document->current_version_id),
            ])
            ->oldest('id')
            ->limit($cap)
            ->get();

        /** @var list<Thread> $carrying */
        $carrying = $threads
            ->filter(fn (Thread $thread): bool => $this->feedbackOf($thread) !== [])
            ->values()
            ->all();

        // A thread whose every comment was deleted or declined carries no
        // feedback at all: it is not "left out for budget", it has nothing to
        // leave out — so it is not counted against coverage either.
        $total = $document->threads()->open()->count() - ($threads->count() - count($carrying));

        $sections = array_map(
            fn (Thread $thread): PromptSection => new PromptSection(
                label: 'thread-'.$thread->id,
                body: $fence->wrap('thread '.$thread->id, $this->threadBody($thread)),
            ),
            $carrying,
        );

        [$context, $bodyIncluded, $bodyOmitted] = $this->context($document, $assembler, $fence);

        $assembled = $assembler->assemble(
            task: $this->task($bodyOmitted),
            sections: $sections,
            context: $context,
            totalUnits: max($total, 0),
            unit: 'open threads',
            purpose: 'turn into an improve-the-doc prompt',
        );

        // Only the threads that actually fit the budget describe the artifact:
        // everything else is confessed by the coverage statement instead of
        // appearing as marching orders nobody read.
        $skipped = array_flip((array) ($assembled->meta['skipped_sections'] ?? []));
        $covered = array_values(array_filter(
            $carrying,
            fn (Thread $thread): bool => ! isset($skipped['thread-'.$thread->id]),
        ));

        $briefs = array_map($this->brief(...), $covered);

        $coverage = $bodyOmitted
            ? $assembled->coverage->withNote(
                'The document body was too large to include, so threads were read with their quoted anchors.',
            )
            : $assembled->coverage;

        $requiredEdits = array_sum(array_map(
            fn (ThreadBrief $brief): int => count($brief->requiredEdits),
            $briefs,
        ));

        return new ImprovePromptPlan(
            documentTitle: $document->title,
            versionLabel: $document->versionLabelForVersionId($document->current_version_id),
            sourceUrl: $document->source_url,
            threads: $briefs,
            prompt: new AssembledPrompt(
                chunks: $assembled->chunks,
                coverage: $coverage,
                meta: $assembled->meta + [
                    'document_id' => $document->id,
                    'document_version_id' => $document->current_version_id,
                    'thread_ids' => array_map(fn (ThreadBrief $brief): int => $brief->id, $briefs),
                    'thread_total' => max($total, 0),
                    'required_edits' => $requiredEdits,
                    'document_body_included' => $bodyIncluded,
                ],
            ),
        );
    }

    /**
     * The trusted instruction block. Never contains document or comment content.
     */
    private function task(bool $bodyOmitted): string
    {
        return implode("\n", array_filter([
            'TASK. You are preparing revision instructions for a coding agent that will edit this document.',
            'For each review thread below, return one entry: the thread\'s id exactly as given, and one instruction '
                .'saying what to change in the document so that thread\'s feedback is addressed.',
            'Use only what the thread says. Invent nothing, and return no entry for a thread that is not below.',
            'A comment marked REQUIRED EDIT is a suggested edit the author already accepted; its replacement text is '
                .'applied verbatim by the tool. Never restate or re-word it — describe only what the rest of the '
                .'thread still asks for, or say that the accepted edit is the whole change.',
            'Write imperative and specific: one or two sentences per thread, no preamble.',
            $bodyOmitted
                ? 'The document body is too large to include in this pass; work from each thread\'s quoted anchor.'
                : null,
        ]));
    }

    /**
     * Document context repeated in every chunk: the title, and the body when it
     * fits the body share of the budget. An over-long body is left out whole and
     * confessed — never silently truncated.
     *
     * @return array{string, bool, bool}
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
            $body !== '' && ! $included,
        ];
    }

    /**
     * One thread rendered as plain lines. The caller fences the whole block, so
     * every quote, comment body, and proposed replacement here is inside the
     * fence and labeled as data.
     */
    private function threadBody(Thread $thread): string
    {
        $lines = ['thread id: '.$thread->id];

        $anchor = $this->anchorOf($thread);

        if ($anchor instanceof Anchor) {
            $section = $this->sectionOf($anchor);

            if ($section !== '') {
                $lines[] = 'document section: '.$section;
            }

            // An over-long quote is shortened with the cut MARKED, so the model
            // never reasons from a silently amputated sentence. The artifact's
            // own copy of a REQUIRED EDIT target is never shortened — there the
            // quote is a replace target, and this one is context.
            $lines[] = 'quoted from the document: '
                .Str::limit((string) $anchor->exact, self::MAX_QUOTE_CHARS, '… [quote shortened]');
        }

        foreach ($this->feedbackOf($thread) as $comment) {
            $lines[] = '';
            $lines[] = $this->commentHeading($comment);
            $lines[] = (string) $comment->body_md;

            if ($this->isRequiredEdit($comment)) {
                $lines[] = 'accepted replacement text (applied verbatim by the tool — do not restate it):';
                $lines[] = (string) $comment->proposed_text;
            }
        }

        return implode("\n", $lines);
    }

    private function brief(Thread $thread): ThreadBrief
    {
        $anchor = $this->anchorOf($thread);

        return new ThreadBrief(
            id: $thread->id,
            section: $anchor instanceof Anchor ? $this->sectionOf($anchor) : '',
            quote: $anchor instanceof Anchor ? (string) $anchor->exact : null,
            requiredEdits: array_values(array_map(
                fn (Comment $comment): string => (string) $comment->proposed_text,
                array_filter($this->feedbackOf($thread), $this->isRequiredEdit(...)),
            )),
        );
    }

    /**
     * The comments this thread contributes: everything visible except a DECLINED
     * suggestion, which the author has already said no to.
     *
     * @return list<Comment>
     */
    private function feedbackOf(Thread $thread): array
    {
        return $thread->comments
            ->reject(fn (Comment $comment): bool => $comment->suggestion_status === SuggestionStatus::Declined)
            ->values()
            ->all();
    }

    private function isRequiredEdit(Comment $comment): bool
    {
        return $comment->type === CommentType::Suggestion
            && $comment->suggestion_status === SuggestionStatus::Accepted
            && $comment->proposed_text !== null
            && $comment->proposed_text !== '';
    }

    private function anchorOf(Thread $thread): ?Anchor
    {
        return $thread->anchors->first();
    }

    private function sectionOf(Anchor $anchor): string
    {
        return is_array($anchor->heading_path) ? implode(' > ', $anchor->heading_path) : '';
    }

    private function commentHeading(Comment $comment): string
    {
        $parts = ['comment '.$comment->id, 'participant '.$comment->author_id, $comment->type->value];

        if ($this->isRequiredEdit($comment)) {
            $parts[] = 'REQUIRED EDIT — accepted suggested edit';
        } elseif ($comment->suggestion_status !== null) {
            $parts[] = 'suggestion '.$comment->suggestion_status->value;
        }

        return '['.implode(', ', $parts).']';
    }
}
