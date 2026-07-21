<?php

namespace App\Services\TrackedRepos\Exceptions;

/**
 * Why a repo listing call failed (SPEC §16, M3.6). The tracked-repo tree lister
 * classifies GitHub's non-2xx responses into these reasons; the preview service
 * (and later the scan pipeline, #93) maps each to an author-facing message. Kept
 * distinct from the blob connector's import exceptions because listing has its
 * own recoveries (a bad branch is fixable, a missing repo is not).
 */
enum RepoListingReason: string
{
    /** The repository (or its metadata) could not be reached — 404 or private. */
    case NotFound = 'not_found';

    /** The branch does not exist — the ref is a tag, a SHA, or a typo (2A). */
    case BranchNotFound = 'branch_not_found';

    /** GitHub denied the token (401, or a non-throttle 403) — reconnect/PAT. */
    case Unauthorized = 'unauthorized';

    /** GitHub's rate limit is exhausted (429, or 403 with the budget spent). */
    case RateLimited = 'rate_limited';

    /** An upstream failure that isn't one of the above (5xx, malformed body). */
    case Unavailable = 'unavailable';
}
