<?php

namespace App\Services\Import\Connectors;

use App\Services\Fetch\FetchResult;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Connector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\RateLimitedException;
use App\Services\Import\Exceptions\TokenRevokedException;
use App\Services\Import\FetchedContent;

/**
 * The GitHub-file import mechanics shared by the public reader ({@see GithubPublicConnector})
 * and the PAT reader ({@see GithubPatConnector}), SPEC §5.1. Both parse a
 * `github.com/{owner}/{repo}/blob/{ref}/{path}` link into the contents API,
 * request the raw media type through the one SSRF-guarded doorway, and honor
 * GitHub's rate-limit signals per the §19 registry. The subclasses differ only in
 * their source type, whether they authenticate, and how they treat an auth
 * rejection — kept as two small hooks so the parsing and back-off live in exactly
 * one place.
 */
abstract class AbstractGithubBlobConnector implements Connector
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
        protected readonly GuardedFetcher $fetcher,
    ) {}

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
        // can read Retry-After (and the PAT reader can read a 401) ourselves.
        $result = $this->fetcher->fetch($this->contentsApiUrl($parts), $this->requestHeaders($source));

        if ($result->successful()) {
            return new FetchedContent(
                content: $result->body,
                mime: $result->contentType,
                // The human blob URL, not the api.github.com one: its basename is
                // the real filename, so title/filename synthesis stays sensible.
                finalUrl: $source->url,
            );
        }

        // Throttles first: a 429, or a 403 carrying rate-limit markers, is a
        // back-off — not an auth problem — so it must be classified before the
        // auth guard, which otherwise can't tell a rate-limit 403 from a genuine
        // "forbidden" 403.
        if ($this->isRateLimited($result)) {
            throw new RateLimitedException($this->retryAfter($result));
        }

        // A terminal auth failure won't heal on retry: a 401 (bad/revoked token)
        // or a non-throttle 403 (valid token, no access to this resource). No-op
        // for the public reader, which never authenticates.
        $this->guardAuthentication($result);

        if ($result->status === 404) {
            throw new ImportFailedException('GitHub file not found (404) — check the branch and path.');
        }

        throw new ImportFailedException("GitHub responded with HTTP {$result->status}.");
    }

    public function webhookSupported(): bool
    {
        // Push webhooks arrive with the M6 GitHub App; a file read is one-shot.
        return false;
    }

    public function postComment(DocumentSource $source, string $markdown): void
    {
        // No-op: digest post-back is the M6 GitHub App's job (SPEC 5.1 seam).
    }

    /**
     * Connector-specific auth headers, merged into every request. Empty for the
     * public reader; the PAT reader adds `Authorization: Bearer <token>`.
     *
     * @return array<string, string>
     */
    abstract protected function authHeaders(DocumentSource $source): array;

    /**
     * React to a non-2xx status before the shared rate-limit / 404 handling. The
     * PAT reader turns a 401 into a terminal {@see TokenRevokedException};
     * the public reader does nothing (it never authenticates).
     */
    protected function guardAuthentication(FetchResult $result): void {}

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
    private function requestHeaders(DocumentSource $source): array
    {
        return [
            'Accept' => self::ACCEPT,
            // GitHub rejects API requests without a User-Agent (their docs require one).
            'User-Agent' => 'Kedge',
            'X-GitHub-Api-Version' => self::API_VERSION,
        ] + $this->authHeaders($source);
    }

    /**
     * GitHub signals a throttle with 429, or 403 once the request's budget is
     * spent (`X-RateLimit-Remaining: 0`). A 403 without that marker is a genuine
     * "forbidden" (e.g. a repo the caller can't read) — a real failure, not a back-off.
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

    /** Chars of GitHub's reason to keep — enough to be useful, capped as untrusted. */
    private const MAX_REASON = 200;

    /**
     * GitHub's own reason for a failure, pulled from the JSON body's `message`,
     * for surfacing to the author (e.g. "Must have admin rights to Repository.").
     * Untrusted text (SPEC §13): control chars stripped, whitespace collapsed,
     * hard-truncated. Null when the body isn't JSON or carries no message.
     */
    protected function githubReason(FetchResult $result): ?string
    {
        $decoded = json_decode($result->body, true);
        $message = is_array($decoded) ? ($decoded['message'] ?? null) : null;

        if (! is_string($message) || $message === '') {
            return null;
        }

        $clean = trim((string) preg_replace('/\s+/', ' ', preg_replace('/[\x00-\x1F\x7F]+/', ' ', $message)));

        if ($clean === '') {
            return null;
        }

        return mb_strlen($clean) > self::MAX_REASON
            ? mb_substr($clean, 0, self::MAX_REASON).'…'
            : $clean;
    }
}
