<?php

namespace App\Services\TrackedRepos\Exceptions;

use RuntimeException;

/**
 * A repo listing call (metadata, branch, or tree) failed at the GitHub boundary
 * (SPEC §16, M3.6). Carries a {@see RepoListingReason} the caller maps to a
 * recovery, plus GitHub's own sanitized reason string when it supplied one (never
 * the token — the token is only ever an outbound header).
 */
class RepoListingException extends RuntimeException
{
    public function __construct(
        public readonly RepoListingReason $reason,
        public readonly ?string $detail = null,
    ) {
        parent::__construct("GitHub repo listing failed: {$reason->value}");
    }
}
