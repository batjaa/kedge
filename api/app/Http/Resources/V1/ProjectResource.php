<?php

namespace App\Http\Resources\V1;

use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A project as the web reads it (SPEC §16, M3.6). The home groups by project and
 * offers assignment selectors; the project page renders the description header.
 * The counts each ride an optional `withCount` alias, present only when the query
 * provides it: `documents_count` (the group/roster affordances) always; the
 * dashboard rail's `open_threads_count` / `orphaned_threads_count` (#104) only on
 * the projects index, so the create/update paths — which count documents alone —
 * omit them rather than emit a misleading zero. Hand-kept in sync with
 * web/lib/document-types.ts (Project).
 *
 * @mixin Project
 */
class ProjectResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            'documents_count' => $this->whenCounted('documents'),
            'open_threads_count' => $this->whenCounted('open_threads'),
            'orphaned_threads_count' => $this->whenCounted('orphaned_threads'),
            'created_at' => $this->created_at,
        ];
    }
}
