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

        // Threads with nothing to contribute are excluded IN THE QUERY, before
        // the cap counts them — otherwise five hundred declined-only threads
        // would fill the budget and hide the accepted edit sitting behind them.
        $carryingThreads = $document->threads()->open()->whereHas(
            'comments',
            fn ($query) => $query->withoutTrashed()->where(
                fn ($comment) => $comment
                    ->whereNull('suggestion_status')
                    ->orWhere('suggestion_status', '!=', SuggestionStatus::Declined->value),
            ),
        );

        $threads = (clone $carryingThreads)
            ->with($this->eagerLoads($document))
            ->oldest('id')
            ->limit($cap)
            ->get();

        // Accepted edits are hydrated on their OWN bounded query, not taken from
        // the discussion set above. The cap bounds how much conversation one run
        // reads; it must not decide whether an edit the author already approved
        // reaches them — a review with 500 chatty threads ahead of the accepted
        // one would otherwise drop the only part of this artifact that is a fact
        // rather than a summary.
        $editThreads = $document->threads()
            ->open()
            ->whereHas('comments', fn ($query) => $query->withoutTrashed()
                ->where('type', CommentType::Suggestion->value)
                ->where('suggestion_status', SuggestionStatus::Accepted->value)
                ->whereNotNull('proposed_text'))
            ->with($this->eagerLoads($document))
            ->oldest('id')
            ->limit($cap + 1)
            ->get();

        // One past the cap is enough to know some were left out, without paying
        // to hydrate them all.
        $editsOverCap = $editThreads->count() > $cap;
        $editThreads = $editThreads->take($cap);

        /** @var list<Thread> $carrying */
        $carrying = $threads
            ->filter(fn (Thread $thread): bool => $this->feedbackOf($thread) !== [])
            ->values()
            ->all();

        // A thread whose every comment was deleted or declined carries no
        // feedback at all: it is not "left out for budget", it has nothing to
        // leave out — so it is not counted against coverage either. The query
        // already excludes those; the in-memory filter is the same rule applied
        // to what was actually hydrated, and the two can only ever agree.
        $total = $carryingThreads->count() - ($threads->count() - count($carrying));

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

        // An accepted suggested edit needs no model: the author already approved
        // that exact text. So the required edits come from their own query, not
        // just from the threads that fit the context budget — losing an approved
        // edit because its discussion didn't fit would break the one promise this
        // artifact makes. The omission of the discussion is confessed instead.
        $editBriefs = array_values(array_filter(
            array_map($this->brief(...), $editThreads->all()),
            fn (ThreadBrief $brief): bool => $brief->requiredEdits !== [],
        ));

        $coverage = $assembled->coverage;

        if ($bodyOmitted) {
            // Precise about what the model actually had: a document-level thread
            // has no anchor to be read with, so claiming otherwise would be the
            // kind of confident half-truth coverage exists to prevent.
            $coverage = $coverage->withNote(
                'The document body was too large to include, so each thread was read with its quoted anchor '
                .'where it had one, and with its comments alone otherwise.',
            );
        }

        $coveredIds = array_flip(array_map(fn (ThreadBrief $brief): int => $brief->id, $briefs));
        $uncoveredEdits = array_sum(array_map(
            fn (ThreadBrief $brief): int => isset($coveredIds[$brief->id]) ? 0 : count($brief->requiredEdits),
            $editBriefs,
        ));

        if ($uncoveredEdits > 0) {
            $coverage = $coverage->withNote(sprintf(
                '%d accepted suggested %s from threads this pass could not read %s included verbatim anyway, '
                .'without a summary of the discussion around %s.',
                $uncoveredEdits,
                $uncoveredEdits === 1 ? 'edit' : 'edits',
                $uncoveredEdits === 1 ? 'is' : 'are',
                $uncoveredEdits === 1 ? 'it' : 'them',
            ));
        }

        // The last resort: even the edit query is bounded, so if a review has
        // more accepted edits than one run may hydrate, the artifact says so
        // rather than looking complete.
        if ($editsOverCap) {
            $coverage = $coverage->withNote(sprintf(
                'This review has more than %d threads carrying accepted suggested edits; only the first %d are listed.',
                $cap,
                $cap,
            ));
        }

        $requiredEdits = array_sum(array_map(
            fn (ThreadBrief $brief): int => count($brief->requiredEdits),
            $editBriefs,
        ));

        return new ImprovePromptPlan(
            documentTitle: $document->title,
            versionLabel: $document->versionLabelForVersionId($document->current_version_id),
            sourceUrl: $document->source_url,
            threads: $briefs,
            edits: $editBriefs,
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
     * What a thread needs to be rendered: its live comments, and its anchor on
     * the version under review.
     *
     * @return array<string, callable>
     */
    private function eagerLoads(Document $document): array
    {
        return [
            'comments' => fn ($query) => $query->withoutTrashed()->oldest('id'),
            'anchors' => fn ($query) => $query->where('document_version_id', $document->current_version_id),
        ];
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
                ? 'The document body is too large to include in this pass; work from each thread\'s quoted anchor '
                    .'where it has one, and from its comments alone otherwise.'
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
