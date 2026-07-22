<?php

namespace App\Services\TrackedRepos;

/**
 * The read-only result of resolving a tracked repo against GitHub (SPEC §16,
 * M3.6): the concrete branch a scan/preview ran at, and the repo-relative paths
 * that matched the pattern AND carry an importable extension. Everything unusable
 * (bad ref, truncated listing, over-cap) is a thrown {@see Exceptions\DiscoveryException},
 * never a partial {@see Discovery} — so a caller can trust {@see $paths} whole.
 */
final class Discovery
{
    /**
     * @param  string  $branch  The concrete branch the listing ran at.
     * @param  list<string>  $paths  Sorted matched, importable blob paths.
     * @param  array<string, string>  $blobShas  Matched path → git blob sha, the
     *                                           re-scan change signal (#94). Keyed
     *                                           by every path in {@see $paths}.
     */
    public function __construct(
        public readonly string $branch,
        public readonly array $paths,
        public readonly array $blobShas = [],
    ) {}
}
