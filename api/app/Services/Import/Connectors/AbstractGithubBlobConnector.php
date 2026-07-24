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
use App\Services\Import\GithubBlobUrl;

/**
 * The GitHub-file import mechanics shared by the public reader ({@see GithubPublicConnector})
 * and the PAT reader ({@see GithubPatConnector}), SPEC §5.1. Both interpret a
 * `github.com/{owner}/{repo}/blob/{ref}/{path}` link via the shared
 * {@see GithubBlobUrl} parser, resolve it to the contents API, request the raw
 * media type through the one SSRF-guarded doorway, and honor GitHub's rate-limit
 * signals per the §19 registry. The subclasses differ only in their source type,
 * whether they authenticate, and how they treat an auth rejection — kept as two
 * small hooks so the back-off lives in exactly one place.
 */
abstract class AbstractGithubBlobConnector implements Connector
{
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
        return GithubBlobUrl::fromUrl($url) !== null;
    }

    public function fetch(DocumentSource $source): FetchedContent
    {
        $blob = GithubBlobUrl::fromUrl($source->url)
            ?? throw new ImportFailedException('Not a recognizable GitHub blob URL.');

        // BlockedUrlException / other FetchExceptions propagate to the job, which
        // owns retry-vs-terminal (SPEC 19). Non-2xx is returned, not thrown, so we
        // can read Retry-After (and the PAT reader can read a 401) ourselves.
        $result = $this->fetcher->fetch($this->contentsApiUrl($blob), $this->requestHeaders($source));

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
     * The GitHub contents-API URL for a parsed blob reference. The blob-URL
     * interpretation itself lives in {@see GithubBlobUrl}; this only re-encodes the
     * already-decoded parts onto the API endpoint.
     */
    private function contentsApiUrl(GithubBlobUrl $blob): string
    {
        $encodedPath = implode('/', array_map('rawurlencode', explode('/', $blob->path)));

        return sprintf(
            '%s/repos/%s/%s/contents/%s?ref=%s',
            // The GitHub API base — `https://api.github.com` in production,
            // env-overridable only as the test seam (config/kedge.php, shared with
            // the tree lister); a bare GITHUB_API_HOST keeps the https default.
            (string) config('kedge.github.api_base', 'https://api.github.com'),
            rawurlencode($blob->owner),
            rawurlencode($blob->repo),
            $encodedPath,
            rawurlencode($blob->ref),
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
