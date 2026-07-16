<?php

namespace App\Http\Resources\V1;

use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Thread;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Thread */
class ThreadResource extends JsonResource
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
        $anchor = $this->railAnchor();
        $firstComment = $this->resourceFirstComment();
        $canTriage = ThreadCapabilities::for($request, $this->resource)
            ->canTriage($this->resource);

        return [
            'id' => $this->id,
            'document_id' => $this->document_id,
            'type' => $this->type->value,
            'status' => $this->status->value,
            'forked_from_comment_id' => $this->forked_from_comment_id,
            'forked_into_count' => $this->forkedIntoCount(),
            'forked_into' => $this->forkedIntoReferences(),
            'created_by' => $this->created_by,
            'comment_count' => (int) ($this->comments_count
                ?? ($this->relationLoaded('comments') ? $this->comments->count() : 0)),
            'latest_activity_at' => $this->latest_activity_at
                ?? $firstComment?->created_at
                ?? $this->updated_at,
            'anchor' => $anchor ? AnchorResource::make($anchor) : null,
            'first_comment' => $firstComment ? CommentResource::make($firstComment) : null,
            'comments' => CommentResource::collection($this->whenLoaded('comments')),
            'can_resolve' => $canTriage && $this->status->value === 'open',
            'can_reopen' => $canTriage && $this->status->value === 'resolved',
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    private function railAnchor(): ?Anchor
    {
        if ($this->relationLoaded('railAnchor')) {
            return $this->getRelation('railAnchor');
        }

        if ($this->relationLoaded('anchors')) {
            return $this->anchors->first();
        }

        return null;
    }

    private function resourceFirstComment(): ?Comment
    {
        if ($this->relationLoaded('firstComment')) {
            return $this->getRelation('firstComment');
        }

        if ($this->relationLoaded('comments')) {
            return $this->comments->sortBy('id')->first();
        }

        return null;
    }

    private function forkedIntoCount(): int
    {
        if ($this->relationLoaded('forkedIntoThreads')) {
            return $this->forkedIntoThreads->count();
        }

        return (int) ($this->forked_into_count ?? 0);
    }

    /**
     * @return list<array{thread_id: int, forked_from_comment_id: int|null}>
     */
    private function forkedIntoReferences(): array
    {
        if (! $this->relationLoaded('forkedIntoThreads')) {
            return [];
        }

        return $this->forkedIntoThreads
            ->map(fn (Thread $thread) => [
                'thread_id' => (int) $thread->id,
                'forked_from_comment_id' => $thread->forked_from_comment_id === null
                    ? null
                    : (int) $thread->forked_from_comment_id,
            ])
            ->values()
            ->all();
    }
}
