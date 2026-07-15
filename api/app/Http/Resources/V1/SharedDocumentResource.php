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
        ];
    }
}
