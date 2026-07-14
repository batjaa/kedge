<?php

namespace App\Services\Import;

/**
 * What a connector is asked to fetch (SPEC 5.1). A thin value carrying the
 * source URL and any connector-specific metadata (branch, ref, PAT integration
 * id — all future). The raw-URL tracer only needs the URL.
 */
class DocumentSource
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public readonly string $url,
        public readonly array $meta = [],
    ) {}
}
