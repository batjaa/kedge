<?php

namespace App\Http\Resources\V1;

use App\Models\Workspace;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Workspace
 */
class WorkspaceResource extends JsonResource
{
    /**
     * No "data" envelope — matches the M0/M1 house shape (CurrentUserResource,
     * IntegrationResource). Nested inside CurrentUserResource today; the settings
     * PATCH also returns it top-level, so the web reads one stable workspace shape.
     *
     * @var string|null
     */
    public static $wrap = null;

    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
        ];
    }
}
