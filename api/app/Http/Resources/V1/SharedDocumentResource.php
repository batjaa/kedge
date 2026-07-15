<?php

namespace App\Http\Resources\V1;

use App\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A document as an anonymous share-link visitor reads it (SPEC 10.2) — the
 * public, read-only surface behind `GET /shared/{token}`.
 *
 * Intentionally lean: title, import state, format, and the rendered content.
 * The internal document id is NOT exposed — the token, not an id, is the only
 * handle a visitor gets, so there is nothing to traverse from. No workspace,
 * source URL, sync error, or share metadata leaks onto this surface.
 *
 * The one exception is a demo doc (SPEC §10.3, #25): its entire purpose is to be
 * claimed, so it *does* expose its id and TTL — the anonymous visitor about to
 * sign up needs the id to POST the claim, and a demo doc is a public throwaway
 * with nothing private to guard. `claimable` stays false (and the id stays
 * hidden) for every ordinary share.
 *
 * @mixin Document
 */
class SharedDocumentResource extends JsonResource
{
    /**
     * @var string|null
     */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $isDemo = $this->resource->isDemo();

        return [
            'title' => $this->title,
            'status' => $this->status->value,
            'format' => $this->format->value,
            'current_version' => $this->whenLoaded(
                'currentVersion',
                fn () => $this->currentVersion
                    ? DocumentVersionResource::make($this->currentVersion)
                    : null,
            ),
            // Claim affordance — present only for a demo doc. `document_id` and
            // `expires_at` appear solely when claimable, so an ordinary share
            // still leaks no internal id.
            'claimable' => $isDemo,
            'document_id' => $this->when($isDemo, fn () => $this->id),
            'expires_at' => $this->when($isDemo, fn () => $this->expires_at?->toIso8601String()),
        ];
    }
}
