<?php

namespace App\Http\Resources\V1;

use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A project as the web reads it (SPEC §16, M3.6). The home groups by project and
 * offers assignment selectors; the project page renders the description header.
 * `documents_count` rides an optional `withCount` alias when the query provides
 * it (the list uses it for the group/roster affordances) and is otherwise
 * omitted. Hand-kept in sync with web/lib/document-types.ts (Project).
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
            'created_at' => $this->created_at,
        ];
    }
}
