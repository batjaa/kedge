<?php

namespace Tests\Unit\Services\AI;

use App\Services\AI\AiCostCalculator;
use Laravel\Ai\Responses\Data\Usage;
use Tests\TestCase;

/**
 * AI cost/day is a day-1 metric (SPEC §19), so the arithmetic behind it is
 * pinned — including the honest null for a model with no published price.
 */
class AiCostCalculatorTest extends TestCase
{
    public function test_it_prices_usage_from_the_configured_table(): void
    {
        config(['kedge.ai.pricing' => ['claude-sonnet-5' => ['input' => 3.0, 'output' => 15.0]]]);

        $usage = new Usage(promptTokens: 1_000_000, completionTokens: 200_000);

        $costs = app(AiCostCalculator::class);

        $this->assertSame(1_200_000, $costs->totalTokens($usage));
        $this->assertSame(6.0, $costs->cost('claude-sonnet-5', $usage));
    }

    public function test_cache_traffic_is_billed_at_the_input_rate(): void
    {
        config(['kedge.ai.pricing' => ['claude-sonnet-5' => ['input' => 3.0, 'output' => 15.0]]]);

        $usage = new Usage(cacheWriteInputTokens: 500_000, cacheReadInputTokens: 500_000);

        $this->assertSame(3.0, app(AiCostCalculator::class)->cost('claude-sonnet-5', $usage));
    }

    public function test_an_unpriced_model_records_no_cost_rather_than_a_wrong_one(): void
    {
        config(['kedge.ai.pricing' => []]);

        $costs = app(AiCostCalculator::class);
        $usage = new Usage(promptTokens: 1000, completionTokens: 1000);

        $this->assertNull($costs->cost('claude-something-new', $usage));
        $this->assertNull($costs->cost(null, $usage));
        // Tokens are still recorded — only the money is unknown.
        $this->assertSame(2000, $costs->totalTokens($usage));
    }
}
