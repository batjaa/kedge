<?php

namespace App\Http\Resources\V1;

use App\Models\DocumentVersion;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A document version as the web reads it. `content` is `content_normalized` —
 * the markdown/MDX the reading surface renders (SPEC 6). `import_warnings` is the
 * author-facing list of what didn't survive normalization (SPEC 5.2) — always an
 * array, empty when the import was clean. `mdx_ok` tells the reading surface
 * whether to render the MDX or its plain-markdown fallback (SPEC 6.1) — null for
 * non-MDX formats. `plain_text` / `projection_version` are intentionally omitted:
 * they are the M2 anchor substrate (#18) and nothing consumes them yet.
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
            'import_warnings' => $this->import_warnings ?? [],
            'mdx_ok' => $this->mdx_ok,
            'source_version' => $this->source_version,
            'synced_at' => $this->synced_at,
        ];
    }
}
