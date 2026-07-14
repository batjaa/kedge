<?php

namespace App\Enums;

/**
 * Lifecycle of a document's *first* import (SPEC 16, 5.3).
 *
 * `importing` on create → `ready` once a version exists → `failed` only when the
 * first import never produced a version (a failed *re-sync* keeps the last good
 * version and lives on `last_sync_status`, not here — SPEC 5.3).
 */
enum DocumentStatus: string
{
    case Importing = 'importing';
    case Ready = 'ready';
    case Failed = 'failed';
}
