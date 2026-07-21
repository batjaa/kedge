<?php

namespace App\Services\TrackedRepos;

/**
 * A parsed GitHub repository reference — owner + repo — extracted from a repo URL
 * (SPEC §16, M3.6). The tracked-repo sibling of the blob connector's blob-URL
 * parsing: it claims `github.com/{owner}/{repo}` (with or without a trailing
 * `.git`, `/tree/...`, or slash) and nothing else. Generic git hosts are deferred
 * (SPEC §5.1), so a non-github host yields null — the preview surfaces an
 * "unsupported repo" error rather than fetching an unexpected host.
 */
final class RepoRef
{
    public function __construct(
        public readonly string $owner,
        public readonly string $repo,
    ) {}

    /**
     * Parse a repository URL, or null if it is not a recognizable GitHub repo URL.
     */
    public static function fromUrl(string $url): ?self
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if (! in_array($host, ['github.com', 'www.github.com'], true)) {
            return null;
        }

        $path = (string) parse_url($url, PHP_URL_PATH);
        $segments = array_values(array_filter(explode('/', $path), fn (string $s): bool => $s !== ''));

        // /{owner}/{repo}[/...] — owner and repo are the first two segments; any
        // /tree/{branch} tail (or none) is ignored (the ref is a separate input).
        if (count($segments) < 2) {
            return null;
        }

        $owner = rawurldecode($segments[0]);
        // A `owner/repo.git` clone URL is common — drop the git suffix.
        $repo = preg_replace('/\.git$/', '', rawurldecode($segments[1]));

        if ($owner === '' || $repo === null || $repo === '') {
            return null;
        }

        return new self($owner, $repo);
    }

    /** The canonical `owner/repo` slug, for messages and the persisted record. */
    public function slug(): string
    {
        return "{$this->owner}/{$this->repo}";
    }
}
