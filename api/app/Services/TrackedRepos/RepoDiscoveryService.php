<?php

namespace App\Services\TrackedRepos;

use App\Services\TrackedRepos\Exceptions\PreviewException;
use App\Services\TrackedRepos\Exceptions\RepoListingException;
use App\Services\TrackedRepos\Exceptions\RepoListingReason;

/**
 * The discovery half of the scan pipeline (SPEC §16, M3.6, decisions 2A/4A/9A):
 * resolve the ref (default branch when omitted; a branch-only check rejects
 * tags/SHAs, 2A) → list the tree through the connector boundary → intersect the
 * path pattern with the importable-format allowlist → cap check. It is the one
 * source of truth both {@see TrackedRepoPreviewService} (which then flags
 * overlaps) and the scan service (which then diffs + imports) share, so preview
 * and scan can never drift on which files a repo yields.
 *
 * Every unusable outcome is an explicit {@see PreviewException} — the same loud
 * failure vocabulary the web already switches on (a truncated listing is a
 * repo-level failure, 4A, never a silent partial match; an over-cap match names
 * the count, story 18).
 */
class RepoDiscoveryService
{
    /** The formats Kedge can render (SPEC §5.1) — the intersection every match passes. */
    private const IMPORTABLE_EXTENSIONS = ['md', 'mdx', 'html'];

    public function __construct(
        private readonly GithubRepoClient $client,
        private readonly PathPattern $matcher,
    ) {}

    /**
     * Resolve $repo at $ref (or its default branch) and return the matched,
     * importable paths under $cap. Throws {@see PreviewException} on any repo-level
     * problem — the caller maps it to a preview 422 or a scan repo-level failure.
     *
     * @param  string|null  $token  The workspace PAT, or null for a public read (#23).
     */
    public function discover(RepoRef $repo, ?string $ref, ?string $token, string $pathPattern, int $cap): Discovery
    {
        $this->guardPattern($pathPattern);

        $branch = $this->resolveBranch($repo, $ref, $token);
        $listing = $this->list($repo, $branch, $token);

        // 4A: a truncated listing is a failure, never a silently partial match.
        if ($listing->truncated) {
            throw PreviewException::truncated();
        }

        $matched = $this->match($listing->paths, $pathPattern);

        if (count($matched) > $cap) {
            throw PreviewException::overCap(count($matched), $cap);
        }

        return new Discovery($branch, $matched);
    }

    /**
     * Confine the pattern to repo paths — no traversal (story 19). The tree paths
     * are already clean, so a `..` could only be a mistake or an attempt.
     */
    private function guardPattern(string $pattern): void
    {
        if (preg_match('~(^|/)\.\.(/|$)~', $pattern) === 1) {
            throw PreviewException::invalidPattern();
        }
    }

    /**
     * The branch to list: the given ref (confirmed to be a branch, 2A) or the
     * repo's default branch when omitted. Maps listing failures to preview errors.
     */
    private function resolveBranch(RepoRef $repo, ?string $ref, ?string $token): string
    {
        try {
            // Always probe the repo first (reachability + the default branch), so a
            // repo-level 404 reads as "unreachable", not "bad branch".
            $defaultBranch = $this->client->defaultBranch($repo, $token);

            if ($ref === null || $ref === '') {
                return $defaultBranch;
            }

            $this->client->assertBranch($repo, $ref, $token);

            return $ref;
        } catch (RepoListingException $e) {
            throw $this->mapListingFailure($e, $ref);
        }
    }

    private function list(RepoRef $repo, string $branch, ?string $token): TreeListing
    {
        try {
            return $this->client->listTree($repo, $branch, $token);
        } catch (RepoListingException $e) {
            throw $this->mapListingFailure($e, $branch);
        }
    }

    private function mapListingFailure(RepoListingException $e, ?string $ref): PreviewException
    {
        return match ($e->reason) {
            RepoListingReason::BranchNotFound => PreviewException::invalidRef((string) $ref),
            RepoListingReason::NotFound => PreviewException::unreachable(),
            RepoListingReason::Unauthorized => PreviewException::unauthorized(),
            RepoListingReason::RateLimited => PreviewException::rateLimited(),
            RepoListingReason::Unavailable => PreviewException::unreachable(),
        };
    }

    /**
     * The paths matching the pattern AND carrying an importable extension, sorted.
     *
     * @param  list<string>  $paths
     * @return list<string>
     */
    private function match(array $paths, string $pattern): array
    {
        $matched = array_values(array_filter(
            $paths,
            fn (string $path): bool => $this->matcher->matches($pattern, $path) && $this->isImportable($path),
        ));

        sort($matched);

        return $matched;
    }

    private function isImportable(string $path): bool
    {
        return in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), self::IMPORTABLE_EXTENSIONS, true);
    }
}
