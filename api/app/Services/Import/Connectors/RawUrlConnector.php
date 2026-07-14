<?php

namespace App\Services\Import\Connectors;

use App\Enums\SourceType;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Connector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\FetchedContent;

/**
 * Imports a document from a raw HTTP(S) URL (SPEC 5.1) — a gist, a static-site
 * file, a `raw.githubusercontent.com` link. The catch-all connector: it claims
 * any absolute http/https URL, so it is matched last once source-specific
 * connectors (GitHub, Confluence) arrive.
 *
 * Every fetch goes through {@see GuardedFetcher} — the single SSRF-guarded
 * doorway (SPEC 13). A blocked URL surfaces as its BlockedUrlException; a non-2xx
 * upstream response is a transient {@see ImportFailedException}.
 */
class RawUrlConnector implements Connector
{
    public function __construct(
        private readonly GuardedFetcher $fetcher,
    ) {}

    public function sourceType(): SourceType
    {
        return SourceType::RawUrl;
    }

    public function matches(string $url): bool
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = (string) parse_url($url, PHP_URL_HOST);

        return in_array($scheme, ['http', 'https'], true) && $host !== '';
    }

    public function fetch(DocumentSource $source): FetchedContent
    {
        // BlockedUrlException / FetchException propagate to the job, which decides
        // retry vs. terminal failure (SPEC 19).
        $result = $this->fetcher->fetch($source->url);

        if (! $result->successful()) {
            throw new ImportFailedException("Source responded with HTTP {$result->status}.");
        }

        return new FetchedContent(
            content: $result->body,
            mime: $result->contentType,
            finalUrl: $result->finalUrl,
        );
    }

    public function webhookSupported(): bool
    {
        return false;
    }

    public function postComment(DocumentSource $source, string $markdown): void
    {
        // No-op: a raw URL has nowhere to post a digest back to (SPEC 5.1, M6 seam).
    }
}
