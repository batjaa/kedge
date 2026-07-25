<?php

namespace App\Services\Import;

use App\Services\TrackedRepos\RepoRef;

/**
 * A parsed GitHub blob URL — owner, repo, ref, and repo-relative path — extracted
 * from a `github.com/{owner}/{repo}/blob/{ref}/{path}` link (SPEC §5.1). The single
 * place a blob URL is interpreted: the GitHub connectors
 * ({@see Connectors\GithubPublicConnector}, {@see Connectors\GithubPatConnector})
 * match and fetch through it, and provenance derivation (M3.10) reads the same
 * parse rather than re-implementing it — two parsers drift (SPEC §5.4 rationale).
 *
 * The blob-URL sibling of {@see RepoRef} (which claims
 * the repo-root `github.com/{owner}/{repo}` form). A non-github host, a non-blob
 * path, or a path with no file segment after the ref yields null — never an
 * exception, because imported URLs are untrusted input (SPEC §13).
 */
final class GithubBlobUrl
{
    public function __construct(
        public readonly string $owner,
        public readonly string $repo,
        public readonly string $ref,
        public readonly string $path,
    ) {}

    /**
     * Parse a GitHub blob URL into its parts, or null if it is not one.
     */
    public static function fromUrl(string $url): ?self
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if (! in_array($host, ['github.com', 'www.github.com'], true)) {
            return null;
        }

        $path = (string) parse_url($url, PHP_URL_PATH);
        $segments = array_values(array_filter(explode('/', $path), fn (string $s): bool => $s !== ''));

        // /{owner}/{repo}/blob/{ref}/{path...} — at least one path segment after ref.
        if (count($segments) < 5 || $segments[2] !== 'blob') {
            return null;
        }

        return new self(
            owner: $segments[0],
            repo: $segments[1],
            ref: rawurldecode($segments[3]),
            // A branch/tag ref may contain slashes, but a bare blob URL can't tell
            // where a slash-containing ref ends and the path begins — GitHub resolves
            // that against its real ref list, which we don't have. We keep the legacy
            // first-segment split (segment 4 = ref, remainder = path): exact for the
            // slashless branch/tag/SHA case, and preserved here as a no-behavior change.
            path: implode('/', array_map('rawurldecode', array_slice($segments, 4))),
        );
    }
}
