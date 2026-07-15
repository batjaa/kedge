<?php

namespace App\Enums;

/**
 * A third-party source Kedge holds credentials for, per workspace (SPEC §16).
 * The value backs the `integrations.provider` column.
 *
 * M1 ships `github_pat` only — the self-hoster's primary private-source path
 * (SPEC Rev 3, §5.1). The GitHub App and Confluence providers named in §16 are
 * additive at M6: a new case here plus a connector, no schema change.
 */
enum IntegrationProvider: string
{
    case GithubPat = 'github_pat';
}
