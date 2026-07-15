<?php

namespace App\Services\Import;

/**
 * What a connector is asked to fetch (SPEC 5.1). A thin value carrying the
 * source URL, any connector-specific metadata (branch, ref), and the id of the
 * workspace integration bound to this import — set only for authenticated
 * sources ({@see Connectors\GithubPatConnector}), null for the public/raw ones.
 * The raw-URL tracer only needs the URL.
 */
class DocumentSource
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public readonly string $url,
        public readonly array $meta = [],
        public readonly ?int $integrationId = null,
    ) {}
}
