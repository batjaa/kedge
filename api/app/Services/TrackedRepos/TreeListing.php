<?php

namespace App\Services\TrackedRepos;

/**
 * The result of listing a repo's tree at a ref (SPEC §16, M3.6): the blob
 * (file) paths, their git blob shas, and whether GitHub truncated the listing.
 * Truncation is surfaced explicitly, never swallowed — a truncated tree is a
 * repo-level scan/preview failure (decision 4A), never a silent partial match,
 * so the caller must check {@see $truncated} before trusting {@see $paths}.
 *
 * The blob sha is the re-scan diff's change signal (#94): the scan records it per
 * imported path and, on the next scan, a differing sha for a held path is what
 * "changed" means. Preview ignores it; only the scan diff consumes it.
 */
final class TreeListing
{
    /**
     * @param  list<string>  $paths  Repo-relative blob paths (directories excluded).
     * @param  array<string, string>  $blobShas  Path → git blob sha, for every path above.
     */
    public function __construct(
        public readonly array $paths,
        public readonly bool $truncated,
        public readonly array $blobShas = [],
    ) {}
}
