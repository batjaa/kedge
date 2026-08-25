<?php

namespace Tests\Unit\Services\AI;

use App\Jobs\GenerateAiRunJob;
use App\Services\AI\AiRunBudget;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The relation between the two clocks an AI run races (#153). The bug this
 * pins: an HTTP timeout SHORTER than the job's own budget kills generations the
 * job would happily have waited for, and one LONGER than it hands the kill to
 * the queue, which cannot say what went wrong.
 */
class AiRunBudgetTest extends TestCase
{
    /**
     * @return array<string, array{int, int}>
     */
    public static function budgets(): array
    {
        return [
            'the shipped default' => [300, 270],
            'a raised budget' => [900, 870],
            'a lowered budget' => [120, 90],

            // At or under the safety margin the budget halves rather than
            // subtracting to nothing.
            'exactly the margin' => [30, 15],
            'under the margin' => [20, 10],
            'odd and small' => [3, 2],
            'two seconds' => [2, 1],

            // Nonsense overrides: the job floors at one second, and so does the
            // call it makes.
            'one second' => [1, 1],
            'zero' => [0, 1],
            'negative' => [-90, 1],
        ];
    }

    #[DataProvider('budgets')]
    public function test_the_http_clock_is_derived_from_the_job_budget(int $configured, int $expected): void
    {
        config(['kedge.ai.job_timeout' => $configured]);

        $this->assertSame($expected, AiRunBudget::http());
    }

    /**
     * The invariant, checked across every value an operator could plausibly
     * type into `AI_JOB_TIMEOUT` — including the degenerate ones. A one-second
     * budget is the sole case where the two clocks meet: nothing positive sits
     * below the floor, and the job's alarm is armed first anyway.
     */
    public function test_no_budget_an_operator_can_type_outlives_the_job(): void
    {
        $configurations = array_merge(
            range(-5, 70),
            [90, 100, 120, 299, 300, 301, 600, 900, 3600, 86400],
        );

        foreach ($configurations as $configured) {
            config(['kedge.ai.job_timeout' => $configured]);

            $job = AiRunBudget::job();
            $http = AiRunBudget::http();

            $this->assertGreaterThanOrEqual(1, $http, "http clock collapsed at job_timeout={$configured}");
            $this->assertGreaterThanOrEqual(1, $job, "job clock collapsed at job_timeout={$configured}");

            if ($job === 1) {
                $this->assertSame(1, $http, "the floor case changed at job_timeout={$configured}");

                continue;
            }

            $this->assertLessThan($job, $http, "http clock outlived the job at job_timeout={$configured}");
        }
    }

    public function test_the_job_carries_the_budget_it_was_dispatched_under(): void
    {
        config(['kedge.ai.job_timeout' => 480]);

        $job = new GenerateAiRunJob(1);

        $this->assertSame(480, $job->timeout);
        $this->assertSame(AiRunBudget::job(), $job->timeout);
    }

    /**
     * The backoff schedule and the terminal-timeout stance are the run
     * lifecycle contract; #153 changes the clocks, not the contract.
     */
    public function test_the_retry_contract_is_untouched(): void
    {
        $job = new GenerateAiRunJob(1);

        $this->assertSame(3, $job->tries);
        $this->assertSame([10, 30, 60], $job->backoff());
        $this->assertTrue($job->failOnTimeout);
    }
}
