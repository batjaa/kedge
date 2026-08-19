<?php

namespace App\Services\Agents;

use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The agent-facing projection of a review (SPEC §15, #135) — the MCP
 * counterpart to `app/Http/Resources/V1`, kept as its own shape on purpose.
 *
 * The REST resources carry `can_resolve`, `can_reanchor`, `can_react` and
 * friends: capability hints the web renders buttons from. On MCP those fields
 * would be worse than noise — they would advertise, in every payload, actions
 * that have no tool and never will (SPEC §15: approvals, lifecycle, resolve,
 * suggestions, shares are absent from the surface, not guarded on it). An agent
 * reading `"can_resolve": true` would be reading a lie about its own reach. So
 * the agent view is deliberately capability-free: facts about the document and
 * the conversation, nothing about buttons.
 *
 * Two agent-specific inclusions earn their place:
 *   - a version's `plain_text` + `projection_version`, because anchor offsets
 *     are UTF-16 code units into exactly that string — without it an agent
 *     cannot construct an anchor the capture path will accept;
 *   - every comment's `client`, so an agent can see which voices in a thread are
 *     its peers rather than people.
 */
class McpPayload
{
    /**
     * A document as it appears in `list_documents` — identity and review state,
     * no content (the list is a directory, `get_document` is the read).
     *
     * @return array<string, mixed>
     */
    public function documentSummary(Document $document): array
    {
        return [
            'id' => (int) $document->id,
            'title' => $document->title,
            'status' => $document->status->value,
            'lifecycle_status' => $document->lifecycle_status->value,
            'format' => $document->format->value,
            'source_url' => $document->source_url,
            'current_version_id' => $document->current_version_id === null
                ? null
                : (int) $document->current_version_id,
            'updated_at' => $document->updated_at?->toJSON(),
        ];
    }

    /**
     * A document plus the requested (or current) version, content included.
     *
     * @return array<string, mixed>
     */
    public function document(Document $document, ?DocumentVersion $version): array
    {
        return [
            'document' => $this->documentSummary($document),
            'version' => $version === null ? null : $this->version($version),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function version(DocumentVersion $version): array
    {
        return [
            'id' => (int) $version->id,
            'kind' => $version->kind->value,
            'source_version' => $version->source_version,
            'synced_at' => $version->synced_at?->toJSON(),
            'content' => $version->content_normalized,
            // The anchor substrate (SPEC §5.4). `start`/`end` on any anchor an
            // agent posts are UTF-16 code-unit offsets into THIS string, and the
            // capture path re-checks that `exact` really sits there — so a tool
            // that omitted the projection would make `post_comment`'s anchor
            // argument unusable by construction.
            'plain_text' => $version->plain_text,
            'projection_version' => $version->projection_version,
        ];
    }

    /**
     * A thread's rail-level shape: the conversation without its bodies, for
     * `list_threads`.
     *
     * @return array<string, mixed>
     */
    public function threadSummary(Thread $thread): array
    {
        $anchor = $this->railAnchorOf($thread);

        return [
            'id' => (int) $thread->id,
            'document_id' => (int) $thread->document_id,
            'type' => $thread->type->value,
            'status' => $thread->status->value,
            'forked_from_comment_id' => $thread->forked_from_comment_id === null
                ? null
                : (int) $thread->forked_from_comment_id,
            'comment_count' => (int) ($thread->comments_count
                ?? ($thread->relationLoaded('comments') ? $thread->comments->count() : 0)),
            'latest_activity_at' => $this->asJsonDate($thread->latest_activity_at)
                ?? $thread->updated_at?->toJSON(),
            'anchor' => $anchor === null ? null : $this->anchor($anchor),
            'created_at' => $thread->created_at?->toJSON(),
        ];
    }

    /**
     * A thread with its full conversation, for `get_thread` and the two writes.
     *
     * @return array<string, mixed>
     */
    public function thread(Thread $thread): array
    {
        return [
            ...$this->threadSummary($thread),
            'comments' => $thread->relationLoaded('comments')
                ? $thread->comments->map(fn (Comment $comment): array => $this->comment($comment))->values()->all()
                : [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function comment(Comment $comment): array
    {
        $isDeleted = $comment->trashed();

        return [
            'id' => (int) $comment->id,
            'thread_id' => (int) $comment->thread_id,
            'author' => $comment->relationLoaded('author') && $comment->author !== null
                ? ['id' => (int) $comment->author->id, 'name' => $comment->author->name]
                : null,
            'type' => $comment->type->value,
            // A deleted comment keeps its place in the thread (M2 tombstones) but
            // surrenders its body — to agents exactly as to people.
            'body_md' => $isDeleted ? null : $comment->body_md,
            'proposed_text' => $isDeleted ? null : $comment->proposed_text,
            'suggestion_status' => $isDeleted ? null : $comment->suggestion_status?->value,
            // web | mcp — who is arguing with whom (user story 15).
            'client' => $comment->client->value,
            'is_deleted' => $isDeleted,
            'edited_at' => $comment->edited_at?->toJSON(),
            'created_at' => $comment->created_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function anchor(Anchor $anchor): array
    {
        return [
            'exact' => $anchor->exact,
            'prefix' => $anchor->prefix,
            'suffix' => $anchor->suffix,
            'start' => (int) $anchor->start,
            'end' => (int) $anchor->end,
            'heading_path' => array_values((array) ($anchor->heading_path ?? [])),
            'projection_version' => $anchor->projection_version,
            'document_version_id' => (int) $anchor->document_version_id,
            'state' => $anchor->state->value,
        ];
    }

    /**
     * The pagination envelope every MCP list tool returns (G11) — the same
     * page/per-page contract as every REST list endpoint (SPEC §17), reported
     * explicitly so an agent knows there is more rather than assuming a short
     * page means the end.
     *
     * @param  LengthAwarePaginator<int, mixed>  $paginator
     * @return array<string, mixed>
     */
    public function pagination(LengthAwarePaginator $paginator): array
    {
        return [
            'page' => $paginator->currentPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'last_page' => $paginator->lastPage(),
            'has_more' => $paginator->hasMorePages(),
        ];
    }

    private function railAnchorOf(Thread $thread): ?Anchor
    {
        if ($thread->relationLoaded('railAnchor')) {
            $anchor = $thread->getRelation('railAnchor');

            return $anchor instanceof Anchor ? $anchor : null;
        }

        if ($thread->relationLoaded('anchors')) {
            return $thread->anchors->first();
        }

        return null;
    }

    /**
     * `latest_activity_at` arrives as a raw string from the rail's aggregate
     * query and as a Carbon instance from the single-thread load; normalise so
     * one field never changes type between two tools.
     */
    private function asJsonDate(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if (is_object($value) && method_exists($value, 'toJSON')) {
            return (string) $value->toJSON();
        }

        return (string) $value;
    }
}
