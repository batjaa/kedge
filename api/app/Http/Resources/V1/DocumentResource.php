<?php

namespace App\Http\Resources\V1;

use App\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A document as the web polls and renders it (SPEC 5.3). The web drives its UI
 * off `status` (importing → ready → failed) and, on failure, `sync_error` for
 * the retry CTA. `current_version` is included only when the relation is loaded
 * (the show route) and carries the markdown once the import lands.
 *
 * Hand-kept in sync with web/lib/document-types.ts (TS/PHP duplication is
 * accepted debt until OpenAPI codegen — TODOS).
 *
 * @mixin Document
 */
class DocumentResource extends JsonResource
{
    /**
     * No "data" envelope — matches the M0 house shape (CurrentUserResource), so
     * the web reads the document fields at the top level.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'status' => $this->status->value,
            'format' => $this->format->value,
            'source_type' => $this->source_type->value,
            'source_url' => $this->source_url,
            'last_sync_status' => $this->last_sync_status->value,
            'sync_error' => $this->sync_error,
            'lifecycle_status' => $this->lifecycle_status->value,
            // The document's project (M3.6), for the review header's assignment
            // selector. Included only when the relation is loaded (show/update);
            // null is Unfiled.
            'project' => $this->whenLoaded(
                'project',
                fn () => $this->project
                    ? ['id' => $this->project->id, 'name' => $this->project->name]
                    : null,
            ),
            'approvals' => ApprovalResource::collection($this->whenLoaded('activeApprovals')),
            'capabilities' => [
                'update_lifecycle' => $request->user()?->can('updateLifecycle', $this->resource) ?? false,
            ],
            'current_version' => $this->whenLoaded(
                'currentVersion',
                fn () => $this->currentVersion
                    ? DocumentVersionResource::make($this->currentVersion)
                        ->withProjectionSubstrate()
                        ->withOrdinal($this->ordinalForVersionId((int) $this->currentVersion->id))
                    : null,
            ),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
