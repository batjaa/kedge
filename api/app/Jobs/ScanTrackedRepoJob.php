<?php

namespace App\Jobs;

use App\Models\TrackedRepo;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Runs one tracked-repo scan off the request path (SPEC §16, M3.6). Dispatched by
 * the create endpoint (the first scan) and the re-scan trigger; both return 202 at
 * once so a slow GitHub listing never blocks the UI.
 *
 * Concurrency is guarded inside the service by an atomic claim (5A), NOT by
 * `ShouldBeUnique` — the claim is the single source of truth ("no cache/lock
 * dependency"), so two dispatched jobs both run and exactly one wins the claim; the
 * loser no-ops. `tries = 1`: the service already writes a terminal report for every
 * expected failure (repo-level and per-file), so a throw here is a genuine bug or
 * infra fault — retrying would only hit the no-op claim path. The record is left
 * `running` and recovered by the stale-running reclaim (5A) or a manual re-scan,
 * never wedged.
 */
class ScanTrackedRepoJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(
        public readonly TrackedRepo $trackedRepo,
        public readonly ?int $actorId = null,
    ) {}

    public function handle(TrackedRepoScanService $scanner): void
    {
        $scanner->scan($this->trackedRepo, $this->actorId);
    }
}
