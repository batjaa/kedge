<?php

namespace App\Services\Import\Connectors;

use App\Enums\IntegrationProvider;
use App\Enums\SourceType;
use App\Models\Integration;
use App\Services\Fetch\FetchResult;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\TokenRevokedException;

/**
 * Imports a GitHub file with a workspace's encrypted personal access token (#23,
 * SPEC §5.1) — the permanent private-repo connector and the self-hoster's primary
 * private-source path (SPEC Rev 3). It reads the same blob URLs as
 * {@see GithubPublicConnector} (all parsing and rate-limit handling is shared in
 * {@see AbstractGithubBlobConnector}) but authenticates, so it reads private repos
 * — and public ones too, on the higher authenticated rate budget.
 *
 * Selection is workspace-aware, not URL-only: the import flow prefers this reader
 * over the public one whenever the workspace has a connected PAT
 * ({@see ConnectorRegistry::preferredMatch()}), and records
 * the bound integration on `documents.integration_id`. The token is resolved from
 * that integration at fetch time, used only for the outbound `Authorization`
 * header, and never logged (SPEC §13).
 *
 * Token-revoked path (SPEC §19): GitHub answers a bad/expired/under-scoped token
 * with 401. That is terminal — a {@see TokenRevokedException} the import job marks
 * failed at once (no retry), surfacing the reconnect CTA — not a throttle to back
 * off on and not a transient failure to retry.
 */
class GithubPatConnector extends AbstractGithubBlobConnector
{
    public function sourceType(): SourceType
    {
        return SourceType::GithubPat;
    }

    /**
     * Authenticate with the workspace's stored PAT, resolved from the integration
     * bound to this import. The token is decrypted here, at the moment of use, and
     * lives no longer than the request.
     *
     * @return array<string, string>
     */
    protected function authHeaders(DocumentSource $source): array
    {
        return ['Authorization' => 'Bearer '.$this->token($source)];
    }

    /**
     * A 401 means the token was revoked, expired, or never had access. Terminal —
     * retrying with the same dead token is pointless (SPEC §19). A 403 is left to
     * the shared handling, where a rate-limit 403 backs off and any other is a
     * normal import failure.
     */
    protected function guardAuthentication(FetchResult $result): void
    {
        if ($result->status === 401) {
            throw new TokenRevokedException(
                'GitHub rejected the PAT-authenticated fetch with HTTP 401.',
            );
        }
    }

    /**
     * The PAT for this import, from the integration recorded on the document. A
     * missing or wrong-provider integration is a real import failure (it should
     * never happen — selection binds a GitHub PAT before dispatch).
     */
    private function token(DocumentSource $source): string
    {
        $integration = $source->integrationId !== null
            ? Integration::find($source->integrationId)
            : null;

        if ($integration === null || $integration->provider !== IntegrationProvider::GithubPat) {
            throw new ImportFailedException('No GitHub integration is connected for this import.');
        }

        return $integration->token();
    }
}
