<?php

namespace App\Enums;

/**
 * Health of a document's most recent sync with its source (SPEC 16, 5.3).
 *
 * `ok` while the source is reachable and the last import/re-sync succeeded;
 * `failed` (paired with `documents.sync_error`) when a fetch fell over. Distinct
 * from {@see DocumentStatus}: a re-sync can fail without disturbing a document
 * that already has a good version.
 */
enum SyncStatus: string
{
    case Ok = 'ok';
    case Failed = 'failed';
}
