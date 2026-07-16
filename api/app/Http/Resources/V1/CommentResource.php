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
        $isDeleted = $this->trashed();
        $capabilities = CommentCapabilities::for($request, $this->resource);

        return [
            'id' => $this->id,
            'thread_id' => $this->thread_id,
            'author' => $this->whenLoaded('author', fn () => [
                'id' => $this->author->id,
                'name' => $this->author->name,
            ]),
            'type' => $this->type->value,
            'body_md' => $isDeleted ? null : $this->body_md,
            'mentions' => $isDeleted ? [] : $this->whenLoaded('mentionedUsers', fn () => $this->mentionedUsers
                ->map(fn ($user) => [
                    'id' => (int) $user->id,
                    'name' => $user->name,
                ])
                ->values()),
            'proposed_text' => $isDeleted ? null : $this->proposed_text,
            'suggestion_status' => $isDeleted ? null : $this->suggestion_status?->value,
            'client' => $this->client->value,
            'edited_at' => $this->edited_at,
            'is_deleted' => $isDeleted,
            'deleted_at' => $this->deleted_at,
            'can_edit' => $capabilities->canEdit($this->resource),
            'can_delete' => $capabilities->canDelete($this->resource),
            'can_fork' => $capabilities->canFork($this->resource),
            'can_resolve_suggestion' => $capabilities->canResolveSuggestion($this->resource),
            'can_react' => $capabilities->canReact($this->resource),
            'reaction_count' => (int) ($this->reaction_count ?? 0),
            'viewer_has_reacted' => (bool) ($this->viewer_has_reacted ?? false),
            'created_at' => $this->created_at,
        ];
    }
}
