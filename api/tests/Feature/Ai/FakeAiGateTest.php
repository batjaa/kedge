<?php

namespace Tests\Feature\Ai;

use App\Providers\FakeAiServiceProvider;
use App\Services\AI\Agents\CommentSplitAgent;
use App\Services\AI\Agents\ImprovePromptAgent;
use App\Services\AI\Agents\ReplyDraftAgent;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\Agents\ThreadSummaryAgent;
use Laravel\Ai\Ai;
use Tests\TestCase;

/**
 * The gate on the E2E scripted-AI seam (#137).
 *
 * {@see FakeAiServiceProvider} replaces every model call with an invented
 * answer. That is exactly what the Playwright journeys need and exactly what
 * must never happen anywhere else: an instance running it would hand its users
 * fabricated review analysis with a real key configured and no sign anything
 * was wrong.
 *
 * So the gate is asserted here rather than trusted: OFF by default in a suite
 * that has an `APP_ENV` the flag would otherwise honor, and scripted only when
 * `kedge.ai.fake` is explicitly true. The second half of the gate — the flag
 * being ignored outside `APP_ENV=e2e`/`testing` — lives in config/kedge.php,
 * where it is evaluated from the environment at load.
 */
class FakeAiGateTest extends TestCase
{
    /** Every agent the provider can script. */
    private const AGENTS = [
        ReviewDigestAgent::class,
        ImprovePromptAgent::class,
        ReplyDraftAgent::class,
        ThreadSummaryAgent::class,
        CommentSplitAgent::class,
    ];

    public function test_the_scripted_fake_is_off_unless_it_is_asked_for(): void
    {
        // The suite runs under APP_ENV=testing — one of the two environments the
        // flag is honored in — so this asserts the FLAG's default, which is the
        // only thing standing between a real deployment and invented output.
        $this->assertFalse((bool) config('kedge.ai.fake'));

        foreach (self::AGENTS as $agent) {
            $this->assertFalse(
                Ai::hasFakeGatewayFor($agent),
                $agent.' must reach the real provider unless the E2E seam is switched on.',
            );
        }
    }

    public function test_a_closed_gate_registers_nothing_and_an_open_one_scripts_every_agent(): void
    {
        config(['kedge.ai.fake' => false]);
        (new FakeAiServiceProvider($this->app))->boot();

        foreach (self::AGENTS as $agent) {
            $this->assertFalse(Ai::hasFakeGatewayFor($agent));
        }

        config(['kedge.ai.fake' => true]);
        (new FakeAiServiceProvider($this->app))->boot();

        foreach (self::AGENTS as $agent) {
            $this->assertTrue(
                Ai::hasFakeGatewayFor($agent),
                $agent.' must be scripted in the E2E environment, or a journey would '
                    .'assert against schema-generated noise.',
            );
        }
    }

    public function test_a_scripted_agent_answers_the_same_way_every_time(): void
    {
        config(['kedge.ai.fake' => true]);
        (new FakeAiServiceProvider($this->app))->boot();

        // Two calls, one gateway: the journeys assert digest CONTENT, so the
        // second chunk of a chunked run must not fall through to the SDK's
        // schema-generated data.
        $first = ReviewDigestAgent::make()->prompt('anything')->toArray();
        $second = ReviewDigestAgent::make()->prompt('anything else')->toArray();

        $this->assertSame($first, $second);
        $this->assertSame(
            FakeAiServiceProvider::DIGEST_THEME_TITLE,
            $first['themes'][0]['title'] ?? null,
        );
    }
}
