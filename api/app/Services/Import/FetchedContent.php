<?php

namespace App\Services\Import;

/**
 * What a connector hands back from a successful fetch (SPEC 5.1): the raw
 * content plus the provenance normalization needs.
 *
 * `title` is only set by connectors that know one authoritatively (e.g. a
 * GitHub API response); the raw-URL connector leaves it null and lets the
 * importer synthesize one from the content or the filename (SPEC 5.2).
 * `finalUrl` is the URL after redirects — the basis for filename synthesis and
 * (later, #19) relative asset resolution.
 */
class FetchedContent
{
    public function __construct(
        public readonly string $content,
        public readonly ?string $mime,
        public readonly string $finalUrl,
        public readonly ?string $title = null,
        public readonly ?string $sourceVersion = null,
    ) {}
}
