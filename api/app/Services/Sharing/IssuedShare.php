<?php

namespace App\Services\Sharing;

use App\Models\Share;

/**
 * The result of minting a share (SPEC 10.2): the persisted row plus the one-time
 * plaintext token and its public URL. The plaintext lives only here, in memory,
 * for the length of the create request — it is never stored and never returned
 * again.
 */
final readonly class IssuedShare
{
    public function __construct(
        public Share $share,
        public string $token,
        public string $url,
    ) {}
}
