<?php

namespace App\Enums;

use App\Models\AiRun;

/**
 * The lifecycle of one AI run (SPEC §14, §16). `pending` on creation, `running`
 * once the queued job picks it up, then exactly one terminal state.
 *
 * Runs are append-only cost/audit history: a terminal run is NEVER reopened —
 * a retry mints a brand-new run through a fresh POST, so a failed row keeps its
 * error and its spend forever (see {@see AiRun::isTerminal()}).
 */
enum AiRunStatus: string
{
    case Pending = 'pending';
    case Running = 'running';
    case Completed = 'completed';
    case Failed = 'failed';

    /**
     * Statuses that mean the run is still on its way to an answer — the dedupe
     * predicate (a second POST joins this run instead of minting one) and the
     * web poller's keep-polling predicate read this one definition.
     */
    public function isInFlight(): bool
    {
        return $this === self::Pending || $this === self::Running;
    }

    public function isTerminal(): bool
    {
        return ! $this->isInFlight();
    }
}
