<?php

namespace App\Http\Resources\V1;

use App\Models\Share;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A share as its author manages it (SPEC 10.2) — the list and create responses.
 *
 * The token and its URL are absent by default: the plaintext is shown exactly
 * once, at creation, where the controller attaches it via {@see withUrl()}.
 * Listing an existing share can only ever show its state, never resurrect a
 * link.
 *
 * Hand-kept in sync with web/lib/share-types.ts (TS/PHP duplication is accepted
 * debt until OpenAPI codegen — TODOS).
 *
 * @mixin Share
 */
class ShareResource extends JsonResource
{
    /**
     * No "data" envelope — matches the M0/M1 house shape.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * The one-time share URL. Set only on the create response; null (and omitted)
     * everywhere else. A declared property, so it is never proxied to the model.
     */
    private ?string $shareUrl = null;

    /**
     * Attach the one-time plaintext URL to this resource (create response only).
     */
    public function withUrl(string $url): static
    {
        $this->shareUrl = $url;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'visibility' => $this->visibility->value,
            // Derived lifecycle the UI badges: active vs. why it is dead.
            'status' => $this->isActive() ? 'active' : $this->goneReason(),
            'expires_at' => $this->expires_at,
            'revoked_at' => $this->revoked_at,
            'created_at' => $this->created_at,
            // Present only on the create response — the sole time the link exists.
            'url' => $this->when($this->shareUrl !== null, $this->shareUrl),
        ];
    }
}
