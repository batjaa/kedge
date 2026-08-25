<?php

namespace App\Services\AI;

/**
 * The two clocks an AI run races, and the relation between them (#153).
 *
 *   job()  — the queue's per-attempt ceiling. Terminal by design: a job that
 *            blows through it lands `failed` via the terminal handler, so a run
 *            can never sit `running` forever (SPEC §14, eng review §6).
 *   http() — how long ONE model call may sit on the socket before the HTTP
 *            client gives up on it.
 *
 * The RELATION is why this class exists. laravel/ai defaults an agent's HTTP
 * timeout to 60 seconds, which is far tighter than the job's own 300s budget:
 * any generation in the 61–300s band died on the client while the job would
 * happily have waited, and the corpse read as a network fault, was retried, and
 * re-billed the whole prompt (issue #153, ai_runs run 5 — 2m51s of billed
 * failure). Two independently configured numbers is how that happens, so there
 * is exactly one number here and the other is DERIVED from it: raise
 * `AI_JOB_TIMEOUT` and the HTTP clock follows, never the other way around.
 *
 * `http() < job()` always, so the job's terminal ceiling stays authoritative:
 * whichever way an operator sets the budget, the socket gives up first and the
 * failure is classified by what actually happened rather than by the queue's
 * blunt "took too long". The single exception is a one-second budget, where no
 * positive integer sits below the floor: both clocks read 1s, the job's alarm
 * is armed first and so still wins the race, and a run under a one-second AI
 * budget lands failed either way.
 */
final class AiRunBudget
{
    /**
     * Head-room reserved for everything in an attempt that is NOT the model
     * call: claiming the run, assembling the prompt, recording spend, landing
     * the row. Sized generously — it costs a slow generation half a minute of
     * its ceiling, and buys the guarantee that an HTTP timeout is caught and
     * classified by us rather than by the queue killing the worker mid-write.
     */
    public const SAFETY_MARGIN_SECONDS = 30;

    /**
     * The job's per-attempt ceiling, in seconds.
     *
     * `max(1, ...)` because a zero or negative override must not disable the
     * ceiling — an unbounded AI job is the stuck-`running` row this whole
     * design exists to prevent.
     */
    public static function job(): int
    {
        return max(1, (int) config('kedge.ai.job_timeout', 300));
    }

    /**
     * One model call's HTTP ceiling, in seconds.
     */
    public static function http(): int
    {
        $job = self::job();

        // A budget at or below the margin would otherwise subtract to nothing.
        // Halving it keeps the relation intact for any override an operator can
        // type, instead of leaving a degenerate value to be caught in
        // production by a socket that never times out.
        $margin = min(self::SAFETY_MARGIN_SECONDS, intdiv($job, 2));

        return max(1, $job - $margin);
    }
}
