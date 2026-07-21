<?php

namespace App\Services\TrackedRepos;

/**
 * The result of listing a repo's tree at a ref (SPEC §16, M3.6): the blob
 * (file) paths, and whether GitHub truncated the listing. Truncation is surfaced
 * explicitly, never swallowed — a truncated tree is a repo-level scan/preview
 * failure (decision 4A), never a silent partial match, so the caller must check
 * {@see $truncated} before trusting {@see $paths}.
 */
final class TreeListing
{
    /**
     * @param  list<string>  $paths  Repo-relative blob paths (directories excluded).
     */
    public function __construct(
        public readonly array $paths,
        public readonly bool $truncated,
    ) {}
}
