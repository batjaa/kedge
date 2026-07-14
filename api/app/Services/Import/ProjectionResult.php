<?php

namespace App\Services\Import;

use App\Models\DocumentVersion;

/**
 * What the web projection endpoint returns for a version (SPEC §5.4): the
 * plain-text anchor substrate and the algorithm version it was produced with.
 *
 * `plainText` and `projectionVersion` are stored on the {@see DocumentVersion};
 * `mdxOk` and `warnings` are carried for the MDX-fallback decision and author
 * warning list that land with the hardened MDX pipeline (#20) — nothing consumes
 * them at M1.
 */
class ProjectionResult
{
    /**
     * @param  list<string>  $warnings
     */
    public function __construct(
        public readonly string $plainText,
        public readonly string $projectionVersion,
        public readonly bool $mdxOk,
        public readonly array $warnings,
    ) {}
}
