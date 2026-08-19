<?php

namespace App\Services\AI\Prompt;

/**
 * The shared prompt-assembly foundation (m4 eng review §10). Fence delimiters,
 * untrusted-data labeling, context-budget math, section chunking, and coverage
 * accounting live HERE, once. Per-type builders only select content and shape
 * output — they compose this, they never re-implement it.
 *
 * That is the point: SPEC §13's injection mitigation must be structural, not
 * five copies of the same discipline a sixth builder could forget. A builder
 * cannot put untrusted content into a prompt except through this object's
 * fence, and cannot exceed the budget except by reporting the shortfall as
 * coverage.
 *
 * One assembler per run — it mints one fence nonce, and every section of that
 * run shares it.
 */
final class PromptAssembler
{
    /**
     * Token allowance reserved for the "part i of n" note so the note itself can
     * never push a chunk over the budget.
     */
    private const CHUNK_NOTE_ALLOWANCE_TOKENS = 64;

    /** Token allowance for the blank line between two sections. */
    private const SECTION_SEPARATOR_TOKENS = 2;

    private function __construct(
        private readonly ContextBudget $budget,
        private readonly UntrustedFence $fence,
    ) {}

    /**
     * Start an assembly for one run, with a freshly minted fence nonce.
     */
    public static function forRun(?ContextBudget $budget = null): self
    {
        return new self(
            $budget ?? ContextBudget::fromConfig(),
            UntrustedFence::mint(),
        );
    }

    /**
     * The only way untrusted content enters a prompt.
     */
    public function fence(): UntrustedFence
    {
        return $this->fence;
    }

    public function budget(): ContextBudget
    {
        return $this->budget;
    }

    /**
     * Pack sections into as many budgeted chunks as the ceiling allows, and
     * account honestly for everything that didn't fit.
     *
     * Cuts fall between sections, never inside one. A section too large to fit a
     * chunk on its own is excluded rather than truncated — silence is the one
     * outcome SPEC §14 forbids, so it leaves the building as coverage instead.
     *
     * @param  string  $task  Trusted instructions for this run — never document content.
     * @param  list<PromptSection>  $sections
     * @param  string|null  $context  Fenced material repeated in EVERY chunk (document
     *                                metadata); costs budget in each chunk and is never
     *                                counted as coverage.
     * @param  int|null  $totalUnits  What coverage counts against; defaults to the section count.
     */
    public function assemble(
        string $task,
        array $sections,
        ?string $context = null,
        ?int $totalUnits = null,
        string $unit = 'threads',
    ): AssembledPrompt {
        $total = $totalUnits ?? count($sections);
        $rule = $this->fence->rule();

        $capacity = max(1, $this->budget->maxTokens
            - $this->budget->estimate($rule)
            - $this->budget->estimate($task)
            - ($context === null ? 0 : $this->budget->estimate($context))
            - self::CHUNK_NOTE_ALLOWANCE_TOKENS);

        /** @var list<list<PromptSection>> $groups */
        $groups = [];
        /** @var list<PromptSection> $current */
        $current = [];
        $currentTokens = 0;
        /** @var list<string> $skipped */
        $skipped = [];

        foreach ($sections as $section) {
            $cost = $this->budget->estimate($section->body) + self::SECTION_SEPARATOR_TOKENS;

            // Too big for any single call — excluded, and counted as uncovered.
            if ($cost > $capacity) {
                $skipped[] = $section->label;

                continue;
            }

            if ($current !== [] && $currentTokens + $cost > $capacity) {
                $groups[] = $current;
                $current = [];
                $currentTokens = 0;
            }

            // The chunk ceiling is the run's cost bound: past it, the rest is
            // uncovered rather than unbounded spend.
            if (count($groups) >= $this->budget->maxChunks) {
                $skipped[] = $section->label;

                continue;
            }

            $current[] = $section;
            $currentTokens += $cost;
        }

        if ($current !== []) {
            $groups[] = $current;
        }

        $covered = array_sum(array_map(count(...), $groups));

        return new AssembledPrompt(
            chunks: $this->render($rule, $task, $context, $groups),
            coverage: new Coverage(
                covered: $covered,
                total: $total,
                chunked: count($groups) > 1,
                unit: $unit,
            ),
            meta: [
                'sections' => count($sections),
                'chunks' => count($groups),
                'skipped_sections' => $skipped,
                'budget_tokens' => $this->budget->maxTokens,
                'max_chunks' => $this->budget->maxChunks,
            ],
        );
    }

    /**
     * @param  list<list<PromptSection>>  $groups
     * @return list<string>
     */
    private function render(string $rule, string $task, ?string $context, array $groups): array
    {
        $count = count($groups);

        $chunks = [];

        foreach ($groups as $index => $group) {
            $parts = [$rule, $task];

            if ($context !== null) {
                $parts[] = $context;
            }

            if ($count > 1) {
                $parts[] = sprintf(
                    'This is part %d of %d of a review too large to read in one pass. '
                    .'Analyse only the material in this part; the parts are merged afterwards.',
                    $index + 1,
                    $count,
                );
            }

            foreach ($group as $section) {
                $parts[] = $section->body;
            }

            $chunks[] = implode("\n\n", $parts);
        }

        return $chunks;
    }
}
