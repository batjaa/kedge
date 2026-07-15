<?php

namespace App\Services\Import\Connectors;

use App\Enums\SourceType;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\RateLimitedException;

/**
 * Imports a public GitHub file from a blob URL (SPEC 5.1). It claims
 * `github.com/{owner}/{repo}/blob/{ref}/{path}` links, parses them into the
 * GitHub contents API, and fetches the raw file unauthenticated through the one
 * SSRF-guarded doorway. Because it is registered ahead of the catch-all
 * {@see RawUrlConnector}, a github.com blob URL routes here while a
 * `raw.githubusercontent.com` link (a different host) still falls through to raw.
 *
 * All the mechanics — blob-URL parsing, the raw-media-type request, the SSRF pin,
 * and the §19 rate-limit back-off — live in {@see AbstractGithubBlobConnector},
 * shared with the authenticated {@see GithubPatConnector}. This reader adds
 * nothing: no auth header, and no special auth-failure handling (an unauthenticated
 * caller never sees a 401; a plain 403 on a private repo is a normal import failure).
 *
 * Rate limiting (SPEC §19): an unauthenticated caller shares GitHub's 60 req/h/IP
 * budget, so 429 and 403-with-`X-RateLimit-Remaining: 0` are expected and become a
 * {@see RateLimitedException} the job backs off on.
 */
class GithubPublicConnector extends AbstractGithubBlobConnector
{
    public function sourceType(): SourceType
    {
        return SourceType::GithubPublic;
    }

    /**
     * Unauthenticated — no auth headers.
     *
     * @return array<string, string>
     */
    protected function authHeaders(DocumentSource $source): array
    {
        return [];
    }
}
