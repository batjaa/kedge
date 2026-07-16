<?php

namespace App\Http\Resources\V1;

use App\Models\Comment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Comment */
class CommentResource extends JsonResource
{
    /**
     * No "data" envelope — matches the API's single-resource house shape.
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
            'thread_id' => $this->thread_id,
            'author' => $this->whenLoaded('author', fn () => [
                'id' => $this->author->id,
                'name' => $this->author->name,
            ]),
            'type' => $this->type->value,
            'body_md' => $this->body_md,
            'proposed_text' => $this->proposed_text,
            'suggestion_status' => $this->suggestion_status?->value,
            'client' => $this->client->value,
            'edited_at' => $this->edited_at,
            'created_at' => $this->created_at,
        ];
    }
}
