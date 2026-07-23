<?php

namespace App\Enums;

/**
 * Outcome of a tracked repo's most recent scan (SPEC §16, M3.6, decisions 1A/5A).
 *
 * `pending` is the "a scan is queued" state: the record is born in it (its first
 * scan is dispatched at create), AND the re-scan trigger flips a settled record
 * back to it atomically (A5), so the server owns "queued" before the worker claims
 * and the panel can't settle on the previous report. `running` is the in-flight
 * claim (5A): the scan pipeline advances pending → running via an atomic
 * conditional update so exactly one scan runs at a time; a `running` older than the
 * stale bound is reclaimable, so a crashed worker can never wedge the record. `ok` /
 * `failed` are the terminal outcomes written at scan completion, `failed` paired
 * with `tracked_repos.scan_error` for a repo-level failure (bad ref, revoked PAT,
 * rate limit, truncation, over-cap). Per-file failures never flip the status —
 * they land in the report and the scan still completes `ok` (SPEC §16, §13).
 */
enum TrackedScanStatus: string
{
    /** A scan is queued: the create-time default, and where a re-scan trigger flips a settled record (A5). */
    case Pending = 'pending';

    /** A scan is in flight — the claim the concurrency guard sets (5A). */
    case Running = 'running';

    /** Last scan completed cleanly (per-file failures may still ride the report). */
    case Ok = 'ok';

    /** Last scan failed at the repo level (bad ref, revoked PAT, rate limit). */
    case Failed = 'failed';
}
