<?php

namespace App\Services\AI;

use Carbon\CarbonInterface;
use Closure;

/**
 * The two clocks an AI run races, and the relation between them (#153).
 *
 *   job()  — the attempt's ceiling. Terminal by design: an attempt that blows
 *            through it lands `failed` via the queue's terminal handler, so a
 *            run can never sit `running` forever (SPEC §14, eng review §6).
 *   http() — how long the NEXT model call may sit on the socket before the HTTP
 *            client gives up on it.
 *
 * The RELATION is why this class exists. laravel/ai defaults an agent's HTTP
 * timeout to 60 seconds, which is far tighter than the job's own 300s budget:
 * any generation in the 61–300s band died on the client while the job would
 * happily have waited, and the corpse read as a network fault, was retried, and
 * re-billed the whole prompt (issue #153, ai_runs run 5 — 2m51s of billed
 * failure). Two independently configured numbers is how that happens, so there
 * is exactly one number here and the other is DERIVED from it: raise
 * `AI_JOB_TIMEOUT` and the socket clock follows, never the other way around.
 *
 * `http() < job()` holds unconditionally, for every value an operator can type,
 * so the attempt's terminal ceiling stays authoritative: the socket gives up
 * first and the failure is classified by what actually happened rather than by
 * the queue's blunt "took too long".
 *
 * Two things would break that relation if this class only read config, and
 * {@see self::forAttempt()} is how the job closes both:
 *
 *  1. **Config drift.** A queued job carries the `$timeout` it was DISPATCHED
 *     under; the worker that runs it may boot different config. Read live, a
 *     budget raised after dispatch would hand the socket more time than the
 *     attempt has.
 *  2. **Chunked runs.** A run may make several sequential model calls inside
 *     one attempt. A per-call constant cannot bound their SUM, so the second
 *     chunk of a slow run would still ask for the full budget with barely any
 *     of it left, handing the kill back to the queue.
 *
 * Inside an attempt the budget therefore comes from the job's own ceiling and
 * counts DOWN against a deadline, so the next call is bounded by the time the
 * attempt actually has left.
 */
final class AiRunBudget
{
    /**
     * Head-room reserved for everything in an attempt that is NOT the model
     * call: claiming the run, assembling the prompt, recording spend, landing
     * the row. Sized generously — it costs a slow generation half a minute of
     * its ceiling, and buys the guarantee that a timeout is caught and
     * classified by us rather than by the queue killing the worker mid-write.
     */
    public const SAFETY_MARGIN_SECONDS = 30;

    /**
     * The floor an attempt ceiling is clamped to. Two seconds, not one, so that
     * a nonsense `AI_JOB_TIMEOUT` (0, negative, unparseable) still leaves a
     * whole second below it for the socket clock and the strict inequality
     * never has an exception to explain.
     */
    public const MINIMUM_JOB_SECONDS = 2;

    /**
     * The ceiling of the attempt currently running, if one is.
     */
    private static ?int $attemptCeiling = null;

    /**
     * When that attempt runs out of time.
     */
    private static ?CarbonInterface $attemptDeadline = null;

    /**
     * Run a generation attempt under the ceiling the JOB carries, rather than
     * whatever config the worker happens to hold, and start the clock.
     *
     * Restored on the way out — including on the way out through an exception —
     * so a long-lived worker never leaks one run's deadline into the next.
     *
     * @template TReturn
     *
     * @param  Closure(): TReturn  $attempt
     * @return TReturn
     */
    public static function forAttempt(int $ceiling, Closure $attempt): mixed
    {
        $previousCeiling = self::$attemptCeiling;
        $previousDeadline = self::$attemptDeadline;

        self::$attemptCeiling = max(self::MINIMUM_JOB_SECONDS, $ceiling);
        self::$attemptDeadline = now()->addSeconds(self::$attemptCeiling);

        try {
            return $attempt();
        } finally {
            self::$attemptCeiling = $previousCeiling;
            self::$attemptDeadline = $previousDeadline;
        }
    }

    /**
     * The attempt's ceiling, in seconds — what the queue kills the job at.
     */
    public static function job(): int
    {
        return self::$attemptCeiling ?? max(
            self::MINIMUM_JOB_SECONDS,
            (int) config('kedge.ai.job_timeout', 300),
        );
    }

    /**
     * The next model call's HTTP ceiling, in seconds.
     */
    public static function http(): int
    {
        return self::within(self::remaining());
    }

    /**
     * What the running attempt has left, or its whole ceiling when no attempt
     * is in flight (a direct call, or a test asking what an agent resolves).
     */
    private static function remaining(): int
    {
        if (self::$attemptDeadline === null) {
            return self::job();
        }

        return (int) floor(now()->diffInSeconds(self::$attemptDeadline));
    }

    /**
     * Fit a socket clock inside the given number of seconds.
     *
     * A span at or under the margin would otherwise subtract to nothing, so it
     * halves instead; anything already spent lands on the floor, where the call
     * fails fast on our terms instead of being killed by the queue.
     */
    private static function within(int $seconds): int
    {
        if ($seconds < self::MINIMUM_JOB_SECONDS) {
            return 1;
        }

        return max(1, $seconds - min(self::SAFETY_MARGIN_SECONDS, intdiv($seconds, 2)));
    }
}
