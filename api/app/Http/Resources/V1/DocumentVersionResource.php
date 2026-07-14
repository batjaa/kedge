<?php

namespace App\Http\Resources\V1;

use App\Models\DocumentVersion;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A document version as the web reads it. `content` is `content_normalized` —
 * the markdown the reading surface renders (SPEC 6). `plain_text` /
 * `projection_version` are intentionally omitted: they are the M2 anchor
 * substrate (#18) and nothing consumes them yet.
 *
 * @mixin DocumentVersion
 */
class DocumentVersionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'content_hash' => $this->content_hash,
            'content' => $this->content_normalized,
            'source_version' => $this->source_version,
            'synced_at' => $this->synced_at,
        ];
    }
}
