<?php

namespace Tests\Unit\Services\AI;

use App\Jobs\GenerateAiRunJob;
use App\Services\AI\AiRunBudget;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
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

            // Nonsense overrides: the attempt ceiling floors at two seconds so
            // the socket clock still has a whole second below it.
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
     * The invariant, unconditionally, across every value an operator could
     * plausibly type into `AI_JOB_TIMEOUT` — degenerate ones included.
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
     * A queued job keeps the ceiling it was dispatched under; inside the attempt
     * the socket clock has to keep it too, however the worker is configured.
     */
    public function test_an_attempt_overrides_the_workers_config(): void
    {
        $this->freezeTime();
        config(['kedge.ai.job_timeout' => 900]);

        AiRunBudget::forAttempt(60, function (): void {
            $this->assertSame(60, AiRunBudget::job());
            $this->assertSame(30, AiRunBudget::http());
        });

        // ...and hands the config back on the way out.
        $this->assertSame(900, AiRunBudget::job());
        $this->assertSame(870, AiRunBudget::http());
    }

    /**
     * A chunked run makes several sequential calls inside ONE attempt. A
     * constant per call cannot bound their sum, so the clock counts down: after
     * two minutes of a five-minute attempt, the next call may have three
     * minutes minus the margin, not five.
     */
    public function test_the_clock_counts_down_within_one_attempt(): void
    {
        $this->freezeTime();
        config(['kedge.ai.job_timeout' => 300]);

        AiRunBudget::forAttempt(300, function (): void {
            $this->assertSame(270, AiRunBudget::http());

            $this->travel(120)->seconds();
            $this->assertSame(150, AiRunBudget::http());

            // Past the ceiling: the next call fails fast on our terms rather
            // than handing the kill to the queue.
            $this->travel(200)->seconds();
            $this->assertSame(1, AiRunBudget::http());
        });
    }

    /**
     * A long-lived worker runs job after job in one process. A leaked deadline
     * would silently shrink every later run's clock.
     */
    public function test_a_failed_attempt_does_not_leak_its_deadline(): void
    {
        $this->freezeTime();
        config(['kedge.ai.job_timeout' => 300]);

        try {
            AiRunBudget::forAttempt(300, function (): void {
                $this->travel(200)->seconds();

                throw new RuntimeException('the model call died');
            });
        } catch (RuntimeException) {
            // The next job in this worker is what matters.
        }

        $this->assertSame(300, AiRunBudget::job());
        $this->assertSame(270, AiRunBudget::http());
    }

    /**
     * The invariant holds mid-attempt too, at every point on the countdown.
     */
    public function test_the_clock_never_outlives_the_attempt_it_runs_in(): void
    {
        foreach ([2, 3, 30, 60, 300, 900] as $ceiling) {
            $this->freezeTime();
            $start = now();

            AiRunBudget::forAttempt($ceiling, function () use ($ceiling, $start): void {
                foreach (range(0, $ceiling, max(1, intdiv($ceiling, 7))) as $elapsed) {
                    $this->travelTo($start->copy()->addSeconds($elapsed));

                    $this->assertLessThan(
                        AiRunBudget::job(),
                        AiRunBudget::http(),
                        "http clock outlived a {$ceiling}s attempt at {$elapsed}s elapsed",
                    );
                }
            });

            $this->travelBack();
        }
    }

    /**
     * The third clock, and the one nobody configures on purpose: the driver's
     * reservation lease. Shorter than an attempt, it hands a still-running job
     * to a second worker — which re-bills the prompt, the exact failure #153
     * exists to stop. `ShouldBeUnique` does not help: it dedupes dispatches,
     * not redeliveries.
     */
    public function test_the_queue_lease_outlives_the_longest_attempt(): void
    {
        $ceiling = (new GenerateAiRunJob(1))->timeout;

        foreach (['database', 'beanstalkd', 'redis'] as $connection) {
            $this->assertGreaterThan(
                $ceiling,
                (int) config("queue.connections.{$connection}.retry_after"),
                $connection.' would re-reserve an AI job that is still running',
            );
        }
    }

    /**
     * And it follows the budget: raising `AI_JOB_TIMEOUT` cannot quietly push
     * the attempt past a lease that stayed where it was.
     */
    public function test_the_queue_lease_follows_the_configured_budget(): void
    {
        foreach ([300, 900, 3600] as $budget) {
            $queue = $this->queueConfigUnder($budget);

            foreach (['database', 'beanstalkd', 'redis'] as $connection) {
                $this->assertGreaterThan(
                    $budget,
                    (int) $queue['connections'][$connection]['retry_after'],
                    $connection." lease did not follow AI_JOB_TIMEOUT={$budget}",
                );
            }
        }
    }

    /**
     * Re-evaluate config/queue.php under a substituted environment, the way the
     * AI gate suite re-evaluates config/kedge.php.
     *
     * @return array<string, mixed>
     */
    private function queueConfigUnder(int $budget): array
    {
        $previous = getenv('AI_JOB_TIMEOUT');

        putenv('AI_JOB_TIMEOUT='.$budget);
        $_ENV['AI_JOB_TIMEOUT'] = (string) $budget;
        $_SERVER['AI_JOB_TIMEOUT'] = (string) $budget;

        try {
            return require base_path('config/queue.php');
        } finally {
            unset($_ENV['AI_JOB_TIMEOUT'], $_SERVER['AI_JOB_TIMEOUT']);

            $previous === false ? putenv('AI_JOB_TIMEOUT') : putenv('AI_JOB_TIMEOUT='.$previous);
        }
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
