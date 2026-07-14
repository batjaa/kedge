<?php

namespace App\Enums;

use App\Services\Import\Connector;

/**
 * Where a document was imported from (SPEC 5.1). One case per connector; the
 * value doubles as the connector's registry key and the `documents.source_type`
 * column.
 *
 * M1's tracer ships `raw_url` only. GitHub (public + PAT), upload/paste, and the
 * M6 connectors are additive: a new connector adds a case here and a
 * {@see Connector} implementation — no schema change.
 */
enum SourceType: string
{
    case RawUrl = 'raw_url';
}
