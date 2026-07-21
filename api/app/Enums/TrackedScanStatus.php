<?php

namespace App\Enums;

/**
 * Outcome of a tracked repo's most recent scan (SPEC §16, M3.6, decision 1A).
 *
 * `pending` is the never-scanned state a record is born in — preview and this
 * milestone never scan, so a created tracked repo stays `pending` until the scan
 * pipeline (#93) runs. `ok` / `failed` are written by that pipeline at scan
 * completion, paired with `tracked_repos.scan_error` on failure. The column lands
 * now (READ-ONLY milestone) so preview's overlap query and #93 build on it.
 */
enum TrackedScanStatus: string
{
    /** Born here; never scanned. The create-time default. */
    case Pending = 'pending';

    /** Last scan completed cleanly (written by the scan pipeline, #93). */
    case Ok = 'ok';

    /** Last scan failed at the repo level (bad ref, revoked PAT, rate limit; #93). */
    case Failed = 'failed';
}
