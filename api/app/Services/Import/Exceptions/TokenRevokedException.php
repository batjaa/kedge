<?php

namespace App\Services\Import\Exceptions;

use RuntimeException;

/**
 * A PAT-authenticated GitHub fetch was rejected with 401 — the token was revoked,
 * expired, or never had access (SPEC §19 token-revoked row). Terminal, like a
 * blocked URL: a revoked token will not heal on retry, so the import job marks the
 * document failed at once, with no further attempts, rather than spending its
 * retry budget. Distinct from {@see ImportFailedException} (transient, retried)
 * and {@see RateLimitedException} (backed off).
 *
 * The constructor message is technical, for logs, and carries no token. The
 * end-user copy — with the reconnect CTA the web surfaces — is {@see userMessage()}.
 */
class TokenRevokedException extends RuntimeException
{
    /**
     * @param  string  $message  Technical, for logs; carries no token.
     * @param  string|null  $detail  GitHub's own reason (already sanitized), appended
     *                               to the author-facing copy so a forbidden 403 says
     *                               exactly what to fix. Null when GitHub gave none.
     */
    public function __construct(string $message, private readonly ?string $detail = null)
    {
        parent::__construct($message);
    }

    /**
     * The message shown to the author, and matched by the web to offer a reconnect
     * link. Deliberately actionable and provider-agnostic in tone; GitHub's own
     * reason (e.g. "Must have admin rights to Repository.") is appended when present.
     */
    public function userMessage(): string
    {
        $base = 'GitHub token was revoked or lacks access — reconnect the integration.';

        return $this->detail !== null && $this->detail !== ''
            ? $base.' GitHub said: '.$this->detail
            : $base;
    }
}
