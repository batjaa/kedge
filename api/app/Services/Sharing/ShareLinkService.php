<?php

namespace App\Services\Sharing;

use App\Enums\ShareVisibility;
use App\Models\Document;
use App\Models\Share;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Issues and resolves share links (SPEC 10.2). Business logic lives here, not in
 * the controller: token minting, one-time exposure, hash storage, and the
 * public-URL shape are one concern with one home.
 */
class ShareLinkService
{
    /**
     * Plaintext token length. 48 crypto-random base62 chars (~285 bits) — well
     * past the 32-char floor, URL-safe, and unguessable.
     */
    private const TOKEN_LENGTH = 48;

    /**
     * Mint a share for a document. Returns the persisted row *and* the plaintext
     * token — the only moment it exists in the clear. The caller surfaces it once
     * (as the share URL) and then it is unrecoverable: the row keeps only the
     * hash.
     */
    public function issue(Document $document, User $creator, ?Carbon $expiresAt = null): IssuedShare
    {
        $token = Str::random(self::TOKEN_LENGTH);

        $share = $document->shares()->create([
            'token_hash' => Share::hashToken($token),
            'visibility' => ShareVisibility::Link,
            'expires_at' => $expiresAt,
            'created_by' => $creator->id,
        ]);

        return new IssuedShare($share, $token, $this->urlFor($token));
    }

    /**
     * Resolve a plaintext token to its share (active or not) via the hash index —
     * never a plaintext scan. Returns null only when no such token was ever
     * issued; revoked/expired shares still resolve, so the caller can tell
     * "gone" from "never existed" yet answer both the same way (SPEC 10.2).
     */
    public function resolve(string $token): ?Share
    {
        return Share::query()
            ->where('token_hash', Share::hashToken($token))
            ->first();
    }

    /**
     * The public read surface for a token — the web route the recipient opens.
     * Env-driven (FRONTEND_URL) so every topology is a config change (SPEC 4).
     */
    public function urlFor(string $token): string
    {
        return config('kedge.frontend_url').'/shared/'.$token;
    }
}
