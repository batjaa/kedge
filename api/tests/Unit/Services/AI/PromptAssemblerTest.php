<?php

namespace Tests\Unit\Services\AI;

use App\Services\AI\Prompt\ContextBudget;
use App\Services\AI\Prompt\PromptAssembler;
use App\Services\AI\Prompt\PromptSection;
use Tests\TestCase;

/**
 * The shared assembly foundation: budget math, section chunking, and coverage
 * accounting (m4 eng review §10). Every builder composes this, so its behaviour
 * is asserted here once rather than per builder.
 */
class PromptAssemblerTest extends TestCase
{
    public function test_a_review_inside_the_budget_is_one_chunk_covering_everything(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 4000, maxChunks: 4));

        $assembled = $assembler->assemble('TASK.', $this->sections(3, 100));

        $this->assertCount(1, $assembled->chunks);
        $this->assertFalse($assembled->coverage->chunked);
        $this->assertSame(3, $assembled->coverage->covered);
        $this->assertSame('Covers all 3 threads.', $assembled->coverage->statement());
        $this->assertStringContainsString($assembler->fence()->tag(), $assembled->chunks[0]);
    }

    public function test_an_over_budget_review_is_cut_between_sections_not_inside_one(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 1200, maxChunks: 4));

        $assembled = $assembler->assemble('TASK.', $this->sections(4, 1200));

        $this->assertGreaterThan(1, count($assembled->chunks));
        $this->assertTrue($assembled->coverage->chunked);
        $this->assertSame(4, $assembled->coverage->covered);

        // No section was split: each body appears whole, exactly once, overall.
        $joined = implode("\n", $assembled->chunks);
        foreach ($this->sections(4, 1200) as $section) {
            $this->assertSame(1, substr_count($joined, $section->body));
        }
    }

    public function test_every_chunk_repeats_the_rule_the_task_and_the_context(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 1200, maxChunks: 4));

        $assembled = $assembler->assemble('TASK.', $this->sections(4, 1200), context: 'CONTEXT.');

        foreach ($assembled->chunks as $chunk) {
            $this->assertStringContainsString('SECURITY RULE — READ FIRST.', $chunk);
            $this->assertStringContainsString('TASK.', $chunk);
            $this->assertStringContainsString('CONTEXT.', $chunk);
            $this->assertStringContainsString('This is part', $chunk);
        }
    }

    public function test_the_chunk_ceiling_bounds_spend_and_the_rest_is_reported_as_coverage(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 1200, maxChunks: 2));

        $assembled = $assembler->assemble('TASK.', $this->sections(12, 1200));

        $this->assertCount(2, $assembled->chunks);
        $this->assertTrue($assembled->coverage->isPartial());
        $this->assertSame(12, $assembled->coverage->total);
        $this->assertStringContainsString(
            'the review was too large to read in full',
            $assembled->coverage->statement(),
        );
        $this->assertNotEmpty($assembled->meta['skipped_sections']);
    }

    public function test_a_section_too_large_for_any_chunk_is_excluded_never_truncated(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 1500, maxChunks: 4));

        $huge = new PromptSection('thread-huge', str_repeat('x', 40000));
        $assembled = $assembler->assemble('TASK.', [$huge, ...$this->sections(1, 100)]);

        $this->assertCount(1, $assembled->chunks);
        $this->assertStringNotContainsString($huge->body, $assembled->chunks[0]);
        $this->assertSame(1, $assembled->coverage->covered);
        $this->assertSame(2, $assembled->coverage->total);
        $this->assertContains('thread-huge', $assembled->meta['skipped_sections']);
    }

    public function test_nothing_to_send_produces_no_chunks_and_an_honest_empty_statement(): void
    {
        $assembler = PromptAssembler::forRun(new ContextBudget(maxTokens: 4000, maxChunks: 4));

        $assembled = $assembler->assemble('TASK.', []);

        $this->assertTrue($assembled->isEmpty());
        $this->assertSame(0, $assembled->coverage->total);
        $this->assertSame('No review threads yet — nothing to digest.', $assembled->coverage->statement());
    }

    /**
     * @return list<PromptSection>
     */
    private function sections(int $count, int $chars): array
    {
        $sections = [];

        for ($i = 1; $i <= $count; $i++) {
            $sections[] = new PromptSection('thread-'.$i, 'SECTION'.$i.str_repeat('.', $chars));
        }

        return $sections;
    }
}
