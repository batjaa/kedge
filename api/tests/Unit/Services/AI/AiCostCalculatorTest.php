<?php

namespace Tests\Unit\Services\AI;

use App\Services\AI\AiCostCalculator;
use Laravel\Ai\Responses\Data\Usage;
use Tests\TestCase;

/**
 * AI cost/day is a day-1 metric (SPEC §19), so the arithmetic behind it is
 * pinned — including the honest null for a model the SELECTED provider has no
 * published price for.
 */
class AiCostCalculatorTest extends TestCase
{
    /** The certified table, as config/kedge.php ships it. */
    private function priceSonnetUnder(string $provider): void
    {
        config([
            'kedge.ai.provider' => $provider,
            'kedge.ai.pricing' => [
                $provider => ['claude-sonnet-5' => ['input' => 3.0, 'output' => 15.0]],
            ],
        ]);
    }

    public function test_it_prices_usage_from_the_configured_table(): void
    {
        $this->priceSonnetUnder('anthropic');

        $usage = new Usage(promptTokens: 1_000_000, completionTokens: 200_000);

        $costs = app(AiCostCalculator::class);

        $this->assertSame(1_200_000, $costs->totalTokens($usage));
        $this->assertSame(6.0, $costs->cost('claude-sonnet-5', $usage));
    }

    public function test_cache_traffic_is_billed_at_the_input_rate(): void
    {
        $this->priceSonnetUnder('anthropic');

        $usage = new Usage(cacheWriteInputTokens: 500_000, cacheReadInputTokens: 500_000);

        $this->assertSame(3.0, app(AiCostCalculator::class)->cost('claude-sonnet-5', $usage));
    }

    public function test_an_unpriced_model_records_no_cost_rather_than_a_wrong_one(): void
    {
        config(['kedge.ai.provider' => 'anthropic', 'kedge.ai.pricing' => []]);

        $costs = app(AiCostCalculator::class);
        $usage = new Usage(promptTokens: 1000, completionTokens: 1000);

        $this->assertNull($costs->cost('claude-something-new', $usage));
        $this->assertNull($costs->cost(null, $usage));
        // Tokens are still recorded — only the money is unknown.
        $this->assertSame(2000, $costs->totalTokens($usage));
    }

    /**
     * The #140 case: the same model id, served by a provider whose rates we do
     * not know. A reseller, a cloud marketplace, or a local runtime charges its
     * own price — or nothing — so borrowing the certified provider's number
     * would put a confident lie into the spend metric.
     */
    public function test_a_priced_model_id_on_another_provider_is_unpriced(): void
    {
        $this->priceSonnetUnder('anthropic');
        config(['kedge.ai.provider' => 'openrouter']);

        $usage = new Usage(promptTokens: 1_000_000, completionTokens: 200_000);
        $costs = app(AiCostCalculator::class);

        $this->assertNull($costs->cost('claude-sonnet-5', $usage));
        $this->assertSame(1_200_000, $costs->totalTokens($usage));
    }

    /** A self-hoster who priced their own provider gets that price, not ours. */
    public function test_an_operator_can_price_their_own_provider(): void
    {
        $this->priceSonnetUnder('anthropic');
        config([
            'kedge.ai.provider' => 'ollama',
            'kedge.ai.pricing.ollama' => ['llama3.1' => ['input' => 0.0, 'output' => 0.0]],
        ]);

        $usage = new Usage(promptTokens: 1_000_000, completionTokens: 1_000_000);

        $this->assertSame(0.0, app(AiCostCalculator::class)->cost('llama3.1', $usage));
    }
}
