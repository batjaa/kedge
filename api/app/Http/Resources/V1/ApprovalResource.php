<?php

namespace App\Http\Resources\V1;

use App\Models\Approval;
use App\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Approval */
class ApprovalResource extends JsonResource
{
    /**
     * No "data" envelope for single approval mutations.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $document = $this->relationLoaded('document') ? $this->document : null;

        return [
            'id' => $this->id,
            'user' => $this->whenLoaded('user', fn () => [
                'id' => $this->user->id,
                'name' => $this->user->name,
            ]),
            'document_version_id' => $this->document_version_id,
            'version_label' => "v{$this->document_version_id}",
            'stale' => $document instanceof Document ? $this->staleFor($document) : false,
            'created_at' => $this->created_at,
        ];
    }
}
