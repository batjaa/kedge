<?php

namespace App\Enums;

/**
 * Outcome of a tracked repo's most recent scan (SPEC §16, M3.6, decisions 1A/5A).
 *
 * `pending` is the never-scanned state a record is born in. `running` is the
 * in-flight claim (5A): the scan pipeline sets it via an atomic conditional
 * update so exactly one scan runs at a time; a `running` older than the stale
 * bound is reclaimable, so a crashed worker can never wedge the record. `ok` /
 * `failed` are the terminal outcomes written at scan completion, `failed` paired
 * with `tracked_repos.scan_error` for a repo-level failure (bad ref, revoked PAT,
 * rate limit, truncation, over-cap). Per-file failures never flip the status —
 * they land in the report and the scan still completes `ok` (SPEC §16, §13).
 */
enum TrackedScanStatus: string
{
    /** Born here; never scanned. The create-time default. */
    case Pending = 'pending';

    /** A scan is in flight — the claim the concurrency guard sets (5A). */
    case Running = 'running';

    /** Last scan completed cleanly (per-file failures may still ride the report). */
    case Ok = 'ok';

    /** Last scan failed at the repo level (bad ref, revoked PAT, rate limit). */
    case Failed = 'failed';
}
