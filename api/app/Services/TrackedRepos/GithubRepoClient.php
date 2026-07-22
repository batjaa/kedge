<?php

namespace App\Services\TrackedRepos;

use App\Services\Fetch\Exceptions\FetchException;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\TrackedRepos\Exceptions\RepoListingException;
use App\Services\TrackedRepos\Exceptions\RepoListingReason;

/**
 * The tracked-repo listing capability (SPEC §16, M3.6) — the sibling of the blob
 * connectors, sharing their SSRF-guarded doorway ({@see GuardedFetcher}), their
 * env-configurable API host (config/kedge.php, the test seam), their public /
 * workspace-PAT auth posture, and their §19 rate-limit classification. Where the
 * blob connectors read one file, this resolves a repo's default branch, confirms
 * a ref is a branch (2A — tags and SHAs are rejected because they can't 404 on
 * the branch endpoint), and lists the tree recursively — surfacing GitHub's
 * `truncated` flag explicitly (4A). Read-only: no persistence, no side effects.
 *
 * The token, when present, is the workspace PAT — passed in by the caller, used
 * only for the outbound Authorization header, never logged (SPEC §13).
 */
class GithubRepoClient
{
    private const ACCEPT = 'application/vnd.github+json';

    private const API_VERSION = '2022-11-28';

    public function __construct(
        private readonly GuardedFetcher $fetcher,
    ) {}

    /**
     * The repository's default branch (also the reachability probe — a missing or
     * inaccessible repo throws {@see RepoListingReason::NotFound} here, before any
     * branch/tree call). Used when the author omits a ref (SPEC story 7).
     */
    public function defaultBranch(RepoRef $repo, ?string $token): string
    {
        $metadata = $this->getJson($this->apiUrl($repo, ''), $token);

        $branch = $metadata['default_branch'] ?? null;
        if (! is_string($branch) || $branch === '') {
            throw new RepoListingException(RepoListingReason::Unavailable);
        }

        return $branch;
    }

    /**
     * Confirm the ref names a branch (2A). A 404 on the branch endpoint means it
     * is not a branch — a tag, a commit SHA, or a typo — surfaced as
     * {@see RepoListingReason::BranchNotFound}. Call after {@see defaultBranch}, so
     * a repo-level 404 is already ruled out and this 404 is unambiguously the ref.
     */
    public function assertBranch(RepoRef $repo, string $ref, ?string $token): void
    {
        try {
            $this->getJson($this->apiUrl($repo, '/branches/'.$this->encodeRef($ref)), $token);
        } catch (RepoListingException $e) {
            if ($e->reason === RepoListingReason::NotFound) {
                throw new RepoListingException(RepoListingReason::BranchNotFound, $e->detail);
            }

            throw $e;
        }
    }

    /**
     * List every blob (file) path in the tree at $ref, recursively, plus GitHub's
     * `truncated` flag. Directories are dropped; only files can become documents.
     */
    public function listTree(RepoRef $repo, string $ref, ?string $token): TreeListing
    {
        $body = $this->getJson(
            $this->apiUrl($repo, '/git/trees/'.$this->encodeRef($ref).'?recursive=1'),
            $token,
        );

        $tree = is_array($body['tree'] ?? null) ? $body['tree'] : [];

        $paths = [];
        $blobShas = [];
        foreach ($tree as $entry) {
            if (is_array($entry) && ($entry['type'] ?? null) === 'blob' && is_string($entry['path'] ?? null)) {
                $paths[] = $entry['path'];
                // The git blob sha — the re-scan change signal (#94). Absent shas
                // read as an empty string so a held path with an unknowable sha is
                // treated as changed (a re-sync that content-hash no-ops), never
                // silently skipped.
                $blobShas[$entry['path']] = is_string($entry['sha'] ?? null) ? $entry['sha'] : '';
            }
        }

        return new TreeListing(
            paths: array_values($paths),
            truncated: (bool) ($body['truncated'] ?? false),
            blobShas: $blobShas,
        );
    }

    /**
     * A guarded GET returning the decoded JSON body, or a classified
     * {@see RepoListingException} on any non-2xx or transport failure.
     *
     * @return array<mixed>
     */
    private function getJson(string $url, ?string $token): array
    {
        try {
            $result = $this->fetcher->fetch($url, $this->headers($token));
        } catch (FetchException) {
            // A blocked/timed-out/oversized/DNS-failed fetch is an upstream problem,
            // not a 500 — the preview surfaces it as a clean listing failure.
            throw new RepoListingException(RepoListingReason::Unavailable);
        }

        if (! $result->successful()) {
            throw $this->classify($result);
        }

        $decoded = json_decode($result->body, true);

        if (! is_array($decoded)) {
            throw new RepoListingException(RepoListingReason::Unavailable);
        }

        return $decoded;
    }

    /**
     * Map a non-2xx GitHub response to a listing reason, throttles first (a 403
     * carrying rate-limit markers is a back-off, not an auth failure) — the same
     * ordering the blob connector uses (SPEC §19).
     */
    private function classify(FetchResult $result): RepoListingException
    {
        if ($this->isRateLimited($result)) {
            return new RepoListingException(RepoListingReason::RateLimited, $this->reason($result));
        }

        if ($result->status === 401 || $result->status === 403) {
            return new RepoListingException(RepoListingReason::Unauthorized, $this->reason($result));
        }

        if ($result->status === 404) {
            return new RepoListingException(RepoListingReason::NotFound, $this->reason($result));
        }

        return new RepoListingException(RepoListingReason::Unavailable, $this->reason($result));
    }

    private function isRateLimited(FetchResult $result): bool
    {
        if ($result->status === 429) {
            return true;
        }

        return $result->status === 403
            && ($result->header('retry-after') !== null || $result->header('x-ratelimit-remaining') === '0');
    }

    /**
     * @return array<string, string>
     */
    private function headers(?string $token): array
    {
        $headers = [
            'Accept' => self::ACCEPT,
            'User-Agent' => 'Kedge',
            'X-GitHub-Api-Version' => self::API_VERSION,
        ];

        if ($token !== null && $token !== '') {
            $headers['Authorization'] = 'Bearer '.$token;
        }

        return $headers;
    }

    /**
     * `https://{host}/repos/{owner}/{repo}{suffix}` — host from config (the test
     * seam), owner/repo rawurlencoded so an odd slug can't break the path.
     */
    private function apiUrl(RepoRef $repo, string $suffix): string
    {
        return sprintf(
            'https://%s/repos/%s/%s%s',
            (string) config('kedge.github.api_host', 'api.github.com'),
            rawurlencode($repo->owner),
            rawurlencode($repo->repo),
            $suffix,
        );
    }

    /** Encode a ref for a URL path, preserving `/` so slashed branch names work. */
    private function encodeRef(string $ref): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $ref)));
    }

    /** GitHub's own `message`, sanitized as untrusted text (SPEC §13). */
    private function reason(FetchResult $result): ?string
    {
        $decoded = json_decode($result->body, true);
        $message = is_array($decoded) ? ($decoded['message'] ?? null) : null;

        if (! is_string($message) || $message === '') {
            return null;
        }

        $clean = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[\x00-\x1F\x7F]+/', ' ', $message)));

        return $clean === '' ? null : mb_substr($clean, 0, 200);
    }
}
