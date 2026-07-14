<?php

namespace App\Services\Import\Connectors;

use App\Enums\SourceType;
use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Connector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\RateLimitedException;
use App\Services\Import\FetchedContent;

/**
 * Imports a public GitHub file from a blob URL (SPEC 5.1). It claims
 * `github.com/{owner}/{repo}/blob/{ref}/{path}` links, parses them into the
 * GitHub contents API, and fetches the raw file unauthenticated through the one
 * SSRF-guarded doorway ({@see GuardedFetcher}). Because it is registered ahead of
 * the catch-all {@see RawUrlConnector}, a github.com blob URL routes here while a
 * `raw.githubusercontent.com` link (a different host) still falls through to raw.
 *
 * Rate limiting (SPEC §19): an unauthenticated caller shares GitHub's 60 req/h/IP
 * budget, so 429 and 403-with-`X-RateLimit-Remaining: 0` are expected. Those
 * become a {@see RateLimitedException} carrying the honored back-off, so the import
 * job releases and resumes ("Rate-limited, retrying") instead of burning its
 * failure budget. A plain 403 (private repo) or 404 (gone) is a real import
 * failure. Webhooks and digest post-back are the M6 GitHub App's job — no-ops here.
 */
class GithubPublicConnector implements Connector
{
    /** GitHub's contents API host — always public, always the pinned target. */
    private const API_HOST = 'api.github.com';

    /** The raw media type: the response body is the file itself, no base64 JSON. */
    private const ACCEPT = 'application/vnd.github.raw';

    private const API_VERSION = '2022-11-28';

    /** Floor on any honored back-off, and a ceiling so a far-future reset can't park a job for hours. */
    private const MIN_RETRY_AFTER = 1;

    private const MAX_RETRY_AFTER = 3600;

    public function __construct(
        private readonly GuardedFetcher $fetcher,
    ) {}

    public function sourceType(): SourceType
    {
        return SourceType::GithubPublic;
    }

    public function matches(string $url): bool
    {
        return $this->parseBlobUrl($url) !== null;
    }

    public function fetch(DocumentSource $source): FetchedContent
    {
        $parts = $this->parseBlobUrl($source->url)
            ?? throw new ImportFailedException('Not a recognizable GitHub blob URL.');

        // BlockedUrlException / other FetchExceptions propagate to the job, which
        // owns retry-vs-terminal (SPEC 19). Non-2xx is returned, not thrown, so we
        // can read Retry-After ourselves.
        $result = $this->fetcher->fetch($this->contentsApiUrl($parts), $this->requestHeaders());

        if ($result->successful()) {
            return new FetchedContent(
                content: $result->body,
                mime: $result->contentType,
                // The human blob URL, not the api.github.com one: its basename is
                // the real filename, so title/filename synthesis stays sensible.
                finalUrl: $source->url,
            );
        }

        if ($this->isRateLimited($result)) {
            throw new RateLimitedException($this->retryAfter($result));
        }

        if ($result->status === 404) {
            throw new ImportFailedException('GitHub file not found (404) — check the branch and path.');
        }

        throw new ImportFailedException("GitHub responded with HTTP {$result->status}.");
    }

    public function webhookSupported(): bool
    {
        // Push webhooks arrive with the M6 GitHub App; a public pull is one-shot.
        return false;
    }

    public function postComment(DocumentSource $source, string $markdown): void
    {
        // No-op: digest post-back is the M6 GitHub App's job (SPEC 5.1 seam).
    }

    /**
     * Parse a GitHub blob URL into its parts, or null if it is not one.
     *
     * @return array{owner: string, repo: string, ref: string, path: string}|null
     */
    private function parseBlobUrl(string $url): ?array
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if (! in_array($host, ['github.com', 'www.github.com'], true)) {
            return null;
        }

        $path = (string) parse_url($url, PHP_URL_PATH);
        $segments = array_values(array_filter(explode('/', $path), fn (string $s) => $s !== ''));

        // /{owner}/{repo}/blob/{ref}/{path...} — at least one path segment after ref.
        if (count($segments) < 5 || $segments[2] !== 'blob') {
            return null;
        }

        return [
            'owner' => $segments[0],
            'repo' => $segments[1],
            'ref' => rawurldecode($segments[3]),
            // A branch name may contain slashes, but a blob URL can't tell where the
            // ref ends and the path begins — GitHub itself treats segment 4 as the
            // ref and the remainder as the path. That covers branches, tags, SHAs.
            'path' => implode('/', array_map('rawurldecode', array_slice($segments, 4))),
        ];
    }

    /**
     * @param  array{owner: string, repo: string, ref: string, path: string}  $parts
     */
    private function contentsApiUrl(array $parts): string
    {
        $encodedPath = implode('/', array_map('rawurlencode', explode('/', $parts['path'])));

        return sprintf(
            'https://%s/repos/%s/%s/contents/%s?ref=%s',
            self::API_HOST,
            rawurlencode($parts['owner']),
            rawurlencode($parts['repo']),
            $encodedPath,
            rawurlencode($parts['ref']),
        );
    }

    /**
     * @return array<string, string>
     */
    private function requestHeaders(): array
    {
        return [
            'Accept' => self::ACCEPT,
            // GitHub rejects API requests without a User-Agent (their docs require one).
            'User-Agent' => 'Kedge',
            'X-GitHub-Api-Version' => self::API_VERSION,
        ];
    }

    /**
     * GitHub signals a throttle with 429, or 403 once the unauthenticated budget is
     * spent (`X-RateLimit-Remaining: 0`). A 403 without that marker is a genuine
     * "forbidden" (e.g. a private repo) — a real failure, not a back-off.
     */
    private function isRateLimited(FetchResult $result): bool
    {
        if ($result->status === 429) {
            return true;
        }

        return $result->status === 403
            && ($result->header('retry-after') !== null || $result->header('x-ratelimit-remaining') === '0');
    }

    /**
     * Seconds to back off, honoring `Retry-After` (secondary limits) then
     * `X-RateLimit-Reset` (primary limit, an epoch), with a sane default.
     */
    private function retryAfter(FetchResult $result): int
    {
        $retryAfter = $result->header('retry-after');
        if ($retryAfter !== null && ctype_digit(trim($retryAfter))) {
            return $this->clamp((int) $retryAfter);
        }

        $reset = $result->header('x-ratelimit-reset');
        if ($reset !== null && ctype_digit(trim($reset))) {
            return $this->clamp((int) $reset - now()->getTimestamp());
        }

        return 60;
    }

    private function clamp(int $seconds): int
    {
        return max(self::MIN_RETRY_AFTER, min($seconds, self::MAX_RETRY_AFTER));
    }
}
