<?php

namespace App\Services\TrackedRepos;

/**
 * The outcome of trying to claim a tracked repo's scan slot (SPEC §16, M3.6,
 * decision 5A). {@see $claimed} is the affected-rows verdict of the atomic
 * conditional update — exactly one concurrent claimant sees `true`, every other
 * sees `false` and no-ops (the trigger endpoint stays an idempotent 202).
 * {@see $staleTakeover} records whether this claim reclaimed a `running` older
 * than the stale bound (a crashed worker) — noted in the resulting report so the
 * takeover is never silent.
 */
final class ScanClaim
{
    public function __construct(
        public readonly bool $claimed,
        public readonly bool $staleTakeover,
    ) {}
}
