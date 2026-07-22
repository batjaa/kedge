<?php

namespace App\Services\TrackedRepos\Exceptions;

use App\Services\TrackedRepos\RepoDiscoveryService;
use RuntimeException;

/**
 * Repo discovery cannot proceed (SPEC §16, M3.6). Thrown by the shared
 * {@see RepoDiscoveryService} that BOTH preview and scan
 * run, so it names the failures of either — hence "discovery", not "preview". Every
 * case is a loud, explicit failure the author can act on: a bad repo URL, a
 * non-branch ref (2A), an over-cap match count naming the number (story 18), or a
 * truncated upstream listing (4A, never a silent partial match). Preview renders it
 * as a 422 with a stable `error` discriminator the panel switches on; scan records
 * it as the record's repo-level failure with the same code.
 */
class DiscoveryException extends RuntimeException
{
    /**
     * @param  string  $error  Stable machine code the web panel switches on.
     * @param  int|null  $count  Matched-file count, for the over-cap message.
     * @param  int|null  $cap  The file cap, for the over-cap message.
     */
    public function __construct(
        public readonly string $error,
        string $message,
        public readonly ?int $count = null,
        public readonly ?int $cap = null,
    ) {
        parent::__construct($message);
    }

    public static function unsupportedRepo(): self
    {
        return new self(
            'unsupported_repo',
            'Enter a GitHub repository URL, like https://github.com/owner/repo.',
        );
    }

    public static function invalidPattern(): self
    {
        return new self(
            'invalid_pattern',
            "The path pattern can't step outside the repo (no '..'). Use a repo-relative glob like docs/**/*.md.",
        );
    }

    public static function invalidRef(string $ref): self
    {
        return new self(
            'invalid_ref',
            "Couldn't find a branch named \"{$ref}\". Tracked repos follow a branch — tags and commit SHAs aren't supported.",
        );
    }

    public static function unreachable(): self
    {
        return new self(
            'unreachable',
            "Couldn't reach that repository. Check the URL, and if it's private, connect a GitHub PAT in Settings.",
        );
    }

    public static function unauthorized(): self
    {
        return new self(
            'unauthorized',
            'GitHub denied access to that repository. Reconnect the integration in Settings, or connect a PAT if the repo is private.',
        );
    }

    public static function rateLimited(): self
    {
        return new self(
            'rate_limited',
            "GitHub's rate limit is exhausted. Connect a PAT for a higher quota, then try again.",
        );
    }

    public static function truncated(): self
    {
        return new self(
            'truncated',
            'This repository is too large for GitHub to list in full. Narrow the pattern to a subdirectory, or connect a PAT.',
        );
    }

    public static function overCap(int $count, int $cap): self
    {
        return new self(
            'over_cap',
            "{$count} files match — over the {$cap}-file cap. Narrow the pattern before importing.",
            count: $count,
            cap: $cap,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'error' => $this->error,
            'message' => $this->getMessage(),
            'count' => $this->count,
            'cap' => $this->cap,
        ], fn (mixed $value): bool => $value !== null);
    }
}
