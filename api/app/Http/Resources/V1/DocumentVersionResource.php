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
 * non-MDX formats. Authenticated document reads also expose `plain_text` and
 * `projection_version` so browser-side anchor capture stamps the stored
 * projection substrate; anonymous share reads keep those internals hidden.
 *
 * @mixin DocumentVersion
 */
class DocumentVersionResource extends JsonResource
{
    private bool $includeProjectionSubstrate = false;

    public function withProjectionSubstrate(): self
    {
        $this->includeProjectionSubstrate = true;

        return $this;
    }

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
            'plain_text' => $this->when($this->includeProjectionSubstrate, $this->plain_text),
            'projection_version' => $this->when($this->includeProjectionSubstrate, $this->projection_version),
            'mdx_ok' => $this->mdx_ok,
            'source_version' => $this->source_version,
            'synced_at' => $this->synced_at,
        ];
    }
}
