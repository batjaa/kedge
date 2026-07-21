<?php

namespace App\Services\TrackedRepos;

use App\Models\Integration;
use App\Models\Workspace;
use App\Services\TrackedRepos\Exceptions\PreviewException;
use App\Services\TrackedRepos\Exceptions\RepoListingException;
use App\Services\TrackedRepos\Exceptions\RepoListingReason;

/**
 * Computes a tracked-repo preview read-only (SPEC §16, M3.6, decisions 2A/4A/9A/
 * 10A): resolve the ref (default branch when omitted; a branch-only check rejects
 * tags/SHAs) → list the tree through the connector boundary → intersect the path
 * pattern with the importable-format allowlist → flag overlaps against the
 * workspace's other tracked repos. No persistence, no import — the scan is #93.
 *
 * Every unusable outcome is an explicit {@see PreviewException} (loud failure,
 * never a silent partial), so a bad glob or a huge repo costs one glance.
 */
class TrackedRepoPreviewService
{
    /** The formats Kedge can render (SPEC §5.1) — the intersection every match passes. */
    private const IMPORTABLE_EXTENSIONS = ['md', 'mdx', 'html'];

    public function __construct(
        private readonly GithubRepoClient $client,
        private readonly PathPattern $matcher,
    ) {}

    /**
     * @param  Integration|null  $integration  The workspace PAT, or null for a public read (#23).
     */
    public function preview(
        Workspace $workspace,
        ?Integration $integration,
        string $repoUrl,
        ?string $ref,
        string $pathPattern,
    ): TrackedRepoPreview {
        $repo = RepoRef::fromUrl($repoUrl)
            ?? throw PreviewException::unsupportedRepo();

        $this->guardPattern($pathPattern);

        $token = $integration?->token();
        $branch = $this->resolveBranch($repo, $ref, $token);
        $listing = $this->list($repo, $branch, $token);

        // 4A: a truncated listing is a failure, never a silently partial match.
        if ($listing->truncated) {
            throw PreviewException::truncated();
        }

        $matched = $this->match($listing->paths, $pathPattern);

        $cap = (int) config('kedge.tracked_repos.file_cap', 200);
        if (count($matched) > $cap) {
            throw PreviewException::overCap(count($matched), $cap);
        }

        return $this->withOverlaps($workspace, $matched, $branch, $cap);
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

    /**
     * Flag each matched path that another tracked repo in the workspace already
     * holds (10A). One query — the workspace's tracked documents whose path is in
     * the matched set — keeps it O(1) round-trips regardless of match count.
     *
     * @param  list<string>  $matched
     */
    private function withOverlaps(Workspace $workspace, array $matched, string $branch, int $cap): TrackedRepoPreview
    {
        $overlapping = $matched === []
            ? []
            : $workspace->documents()
                ->whereNotNull('tracked_repo_id')
                ->whereIn('tracked_path', $matched)
                ->pluck('tracked_path')
                ->all();

        $overlapSet = array_flip($overlapping);

        $files = array_map(
            fn (string $path): array => ['path' => $path, 'overlap' => isset($overlapSet[$path])],
            $matched,
        );

        return new TrackedRepoPreview(
            files: array_values($files),
            ref: $branch,
            overlapCount: count($overlapping),
            cap: $cap,
        );
    }
}
