<?php

namespace App\Services\Import;

use App\Enums\SourceType;
use App\Providers\AppServiceProvider;
use App\Services\Import\Connectors\GithubPublicConnector;

/**
 * The ordered set of connectors (SPEC 5.1). {@see match()} resolves a fresh import
 * by URL — it asks each connector in turn and takes the first whose
 * {@see Connector::matches()} claims the URL, so specific connectors (GitHub,
 * Confluence) are registered before the catch-all raw-URL one. {@see forSourceType()}
 * resolves an already-created document by its stored `source_type` — the path the
 * import job uses, and the only way to reach the URL-less upload connector. Wired
 * in {@see AppServiceProvider}; adding a connector is a one-line registration change.
 */
class ConnectorRegistry
{
    /**
     * @param  list<Connector>  $connectors
     */
    public function __construct(
        private readonly array $connectors,
    ) {}

    /**
     * The first connector that claims this URL, or null if none does.
     */
    public function match(string $url): ?Connector
    {
        foreach ($this->connectors as $connector) {
            if ($connector->matches($url)) {
                return $connector;
            }
        }

        return null;
    }

    /**
     * The connector to record for a fresh import, given whether the importing
     * workspace has a connected GitHub PAT (#23). Normally the URL-only
     * {@see match()}, but a GitHub blob URL is upgraded from the public reader to
     * the authenticated PAT reader whenever the workspace has a token: a PAT reads
     * private repos and public ones alike, on the higher authenticated rate
     * budget. Raw and upload sources are never upgraded.
     *
     * Plain {@see match()} still resolves the public reader for a github.com blob
     * URL (the PAT reader is registered after it), so this preference is the only
     * path to the authenticated connector at import-creation time.
     */
    public function preferredMatch(string $url, bool $hasGithubPat): ?Connector
    {
        $connector = $this->match($url);

        if ($hasGithubPat && $connector instanceof GithubPublicConnector) {
            return $this->forSourceType(SourceType::GithubPat);
        }

        return $connector;
    }

    /**
     * The connector that produces the given source type, or null if none is
     * registered for it. The source type doubles as each connector's registry key
     * (see {@see SourceType}).
     */
    public function forSourceType(SourceType $type): ?Connector
    {
        foreach ($this->connectors as $connector) {
            if ($connector->sourceType() === $type) {
                return $connector;
            }
        }

        return null;
    }
}
