<?php

namespace App\Enums;

use App\Services\Import\Connector;

/**
 * Where a document was imported from (SPEC 5.1). One case per connector; the
 * value doubles as the connector's registry key and the `documents.source_type`
 * column.
 *
 * M1 ships `raw_url`, `github_public`, and `upload`. GitHub PAT (#23) and the M6
 * connectors are additive: a new connector adds a case here and a
 * {@see Connector} implementation — no schema change.
 */
enum SourceType: string
{
    case RawUrl = 'raw_url';

    case GithubPublic = 'github_public';

    /**
     * Directly pasted / uploaded content (#22). No URL and no re-sync source —
     * versioning is manual-only; the pasted body lives in `documents.source_meta`
     * so a retry re-imports it.
     */
    case Upload = 'upload';
}
