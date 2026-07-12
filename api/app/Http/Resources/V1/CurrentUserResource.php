<?php

namespace App\Http\Resources\V1;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The who-am-I payload: user + personal workspace. Returned by
 * GET /api/v1/me and by the register/login endpoints, so the web app
 * receives one stable shape everywhere a session is (re)established.
 *
 * @mixin User
 */
class CurrentUserResource extends JsonResource
{
    /**
     * Disable the default "data" envelope — this payload is the response.
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
            'user' => UserResource::make($this->resource),
            'workspace' => WorkspaceResource::make($this->personalWorkspace()),
        ];
    }
}
