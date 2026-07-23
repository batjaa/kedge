<?php

namespace App\Http\Resources\V1;

use App\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The lean home-list row (SPEC 11, decision 6A) — deliberately NOT
 * {@see DocumentResource}, which ships full version content and a capabilities
 * block. This row is read-only navigation, so it carries no content and no
 * per-row capability checks: the home's cost stays flat as a workspace grows.
 *
 * `open_threads_count` rides a `withCount` alias on the list query; `synced_at`
 * comes from a select-limited `currentVersion` eager load (id, document_id,
 * synced_at only). Hand-kept in sync with web/lib/document-types.ts — TS/PHP
 * duplication is accepted debt until OpenAPI codegen (TODOS).
 *
 * @mixin Document
 */
class DocumentListResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'status' => $this->status->value,
            'last_sync_status' => $this->last_sync_status->value,
            'sync_error' => $this->sync_error,
            'lifecycle_status' => $this->lifecycle_status->value,
            'open_threads_count' => (int) $this->open_threads_count,
            'synced_at' => $this->currentVersion?->synced_at,
            // The row's project chip (SPEC 11's reserved slot; M3.6). Lean
            // identity only — id + name — from the select-limited eager load;
            // null is Unfiled.
            'project' => $this->project
                ? ['id' => $this->project->id, 'name' => $this->project->name]
                : null,
            'created_at' => $this->created_at,
        ];
    }
}
