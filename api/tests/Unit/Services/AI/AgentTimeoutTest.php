<?php

namespace Tests\Unit\Services\AI;

use App\Jobs\GenerateAiRunJob;
use App\Services\AI\Agents\CommentSplitAgent;
use App\Services\AI\Agents\DocumentAskAgent;
use App\Services\AI\Agents\ImprovePromptAgent;
use App\Services\AI\Agents\ReplyDraftAgent;
use App\Services\AI\Agents\ReviewDigestAgent;
use App\Services\AI\Agents\ThreadSummaryAgent;
use App\Services\AI\AiRunBudget;
use FilesystemIterator;
use Laravel\Ai\Contracts\Agent;
use PHPUnit\Framework\Attributes\DataProvider;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use ReflectionClass;
use ReflectionMethod;
use Tests\TestCase;

/**
 * No agent may fall back to laravel/ai's 60-second default (#153): a generation
 * in the 61–300s band would die on the socket inside a job that budgeted 300s
 * for it, and the corpse read as a network fault worth retrying — which re-bills
 * the whole prompt.
 *
 * The agent list is DISCOVERED, never written down here. A seventh agent added
 * without the concern fails this suite the day it lands, which is the only
 * version of this test that cannot rot.
 *
 * Note what these assertions are and are not: the SDK fake never sits on a
 * socket, so nothing here measures wall-clock behavior. They pin the RESOLVED
 * CONFIGURATION — the number laravel/ai would hand the HTTP client — through the
 * vendor's own resolution path rather than by calling our trait directly, so the
 * fallback being reached is a failure and not a silent pass.
 */
class AgentTimeoutTest extends TestCase
{
    private const AGENT_DIRECTORY = 'app/Services/AI/Agents';

    private const VENDOR_DEFAULT_TIMEOUT = 60;

    /**
     * @return array<string, array{class-string<Agent>}>
     */
    public static function agents(): array
    {
        $root = dirname(__DIR__, 4).'/'.self::AGENT_DIRECTORY;
        $found = [];

        // RECURSIVE: an agent parked in a subdirectory is still an agent, and a
        // guard that only reads the top level would let it ship on the vendor
        // default while the named-class check below stayed green.
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));

        foreach ($files as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            $relative = trim(str_replace($root, '', $file->getPathname()), '/');
            $class = 'App\\Services\\AI\\Agents\\'.str_replace('/', '\\', substr($relative, 0, -4));

            if (! is_subclass_of($class, Agent::class) || (new ReflectionClass($class))->isAbstract()) {
                continue;
            }

            $found[$class] = [$class];
        }

        return $found;
    }

    /**
     * Guards the guard: a moved directory or a renamed namespace would leave the
     * provider empty and every case below vacuously green.
     */
    public function test_the_agent_directory_is_actually_discovered(): void
    {
        $discovered = array_keys(self::agents());

        foreach ([
            CommentSplitAgent::class,
            DocumentAskAgent::class,
            ImprovePromptAgent::class,
            ReplyDraftAgent::class,
            ReviewDigestAgent::class,
            ThreadSummaryAgent::class,
        ] as $class) {
            $this->assertContains($class, $discovered);
        }
    }

    /**
     * @param  class-string<Agent>  $class
     */
    #[DataProvider('agents')]
    public function test_an_agent_times_out_inside_the_job_budget(string $class): void
    {
        config(['kedge.ai.job_timeout' => 300]);

        $resolved = $this->resolvedTimeout($class);

        $this->assertSame(270, $resolved);
        $this->assertSame(AiRunBudget::http(), $resolved);
        $this->assertNotSame(
            self::VENDOR_DEFAULT_TIMEOUT,
            $resolved,
            $class.' fell back to the laravel/ai default timeout.',
        );
        $this->assertLessThan((new GenerateAiRunJob(1))->timeout, $resolved);
    }

    /**
     * Derived, not duplicated: raising the job budget raises the socket clock
     * with it, and the relation holds at the new value.
     *
     * 900 is chosen so a hardcoded 270 — or the vendor's 60 — cannot pass.
     *
     * @param  class-string<Agent>  $class
     */
    #[DataProvider('agents')]
    public function test_an_agent_follows_a_raised_job_budget(string $class): void
    {
        config(['kedge.ai.job_timeout' => 900]);

        $resolved = $this->resolvedTimeout($class);

        $this->assertSame(870, $resolved);
        $this->assertLessThan((new GenerateAiRunJob(1))->timeout, $resolved);
    }

    /**
     * @param  class-string<Agent>  $class
     */
    #[DataProvider('agents')]
    public function test_an_agent_survives_a_degenerate_job_budget(string $class): void
    {
        config(['kedge.ai.job_timeout' => 10]);

        $resolved = $this->resolvedTimeout($class);

        $this->assertSame(5, $resolved);
        $this->assertLessThan((new GenerateAiRunJob(1))->timeout, $resolved);
    }

    /**
     * A queued job carries the ceiling it was DISPATCHED under. If the socket
     * clock read live config instead, a budget raised after dispatch — a deploy
     * while runs sit in the queue — would hand one model call more time than the
     * attempt running it has, and the queue would do the killing.
     *
     * @param  class-string<Agent>  $class
     */
    #[DataProvider('agents')]
    public function test_an_agent_obeys_the_dispatched_ceiling_not_the_workers_config(string $class): void
    {
        $this->freezeTime();
        config(['kedge.ai.job_timeout' => 60]);
        $queued = new GenerateAiRunJob(1);

        // The worker booted later, with a far larger budget configured.
        config(['kedge.ai.job_timeout' => 900]);

        $resolved = AiRunBudget::forAttempt($queued->timeout, fn (): int => $this->resolvedTimeout($class));

        $this->assertSame(30, $resolved);
        $this->assertLessThan($queued->timeout, $resolved);
    }

    /**
     * The number laravel/ai itself would resolve for this agent, through the
     * vendor's own order: `prompt()` argument, then `timeout()`, then the
     * `Timeout` attribute, then 60.
     *
     * @param  class-string<Agent>  $class
     */
    private function resolvedTimeout(string $class): int
    {
        $agent = app($class);

        $this->assertTrue(
            method_exists($agent, 'getTimeout'),
            'laravel/ai no longer resolves agent timeouts through getTimeout(); this guard needs rewriting.',
        );

        return (new ReflectionMethod($agent, 'getTimeout'))->invoke($agent, null);
    }
}
