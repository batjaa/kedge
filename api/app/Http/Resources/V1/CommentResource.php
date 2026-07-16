<?php

namespace App\Http\Resources\V1;

use App\Models\Comment;
use App\Models\Thread;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;

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
        $isDeleted = $this->trashed();
        $gate = $request->user() ? Gate::forUser($request->user()) : null;

        return [
            'id' => $this->id,
            'thread_id' => $this->thread_id,
            'author' => $this->whenLoaded('author', fn () => [
                'id' => $this->author->id,
                'name' => $this->author->name,
            ]),
            'type' => $this->type->value,
            'body_md' => $isDeleted ? null : $this->body_md,
            'proposed_text' => $isDeleted ? null : $this->proposed_text,
            'suggestion_status' => $isDeleted ? null : $this->suggestion_status?->value,
            'client' => $this->client->value,
            'edited_at' => $this->edited_at,
            'is_deleted' => $isDeleted,
            'deleted_at' => $this->deleted_at,
            'can_edit' => $gate?->allows('updateComment', [Thread::class, $this->resource]) ?? false,
            'can_delete' => $gate?->allows('deleteComment', [Thread::class, $this->resource]) ?? false,
            'can_fork' => $gate?->allows('forkComment', [Thread::class, $this->resource]) ?? false,
            'created_at' => $this->created_at,
        ];
    }
}
