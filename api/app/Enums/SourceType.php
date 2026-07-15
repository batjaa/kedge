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
     * A GitHub file imported with a workspace's encrypted personal access token
     * (#23) — the private-repo path, and the higher authenticated rate budget for
     * public repos too. Same blob-URL shape as {@see GithubPublic}; the connector
     * differs only in authenticating (SPEC §5.1). The bound token lives on the
     * document's `integration_id`.
     */
    case GithubPat = 'github_pat';

    /**
     * Directly pasted / uploaded content (#22). No URL and no re-sync source —
     * versioning is manual-only; the pasted body lives in `documents.source_meta`
     * so a retry re-imports it.
     */
    case Upload = 'upload';
}
