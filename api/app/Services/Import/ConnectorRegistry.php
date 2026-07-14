<?php

namespace App\Services\Import;

use App\Providers\AppServiceProvider;

/**
 * The ordered set of connectors (SPEC 5.1). Import resolution asks each in turn
 * and takes the first whose {@see Connector::matches()} claims the URL, so
 * specific connectors (GitHub, Confluence) are registered before the catch-all
 * raw-URL one. Wired in {@see AppServiceProvider}; adding a
 * connector is a one-line registration change.
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
}
