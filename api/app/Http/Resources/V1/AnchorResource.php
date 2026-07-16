<?php

namespace App\Http\Resources\V1;

use App\Models\Anchor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Anchor */
class AnchorResource extends JsonResource
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
            'document_version_id' => $this->document_version_id,
            'exact' => $this->exact,
            'prefix' => $this->prefix,
            'suffix' => $this->suffix,
            'start' => $this->start,
            'end' => $this->end,
            'heading_path' => $this->heading_path ?? [],
            'projection_version' => $this->projection_version,
            'state' => $this->state->value,
        ];
    }
}
