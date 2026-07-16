<?php

namespace App\Services\Comments;

use App\Enums\CommentType;
use App\Enums\SuggestionStatus;
use App\Enums\ThreadStatus;
use App\Models\Comment;
use App\Models\Thread;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

class CommentModerationService
{
    use RecordsCommentEvents;
    use ResolvesIdempotentComments;

    private const IDEMPOTENCY_SCOPE_FORK = 'fork-comment';

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly CommentThreadService $threads,
    ) {}

    protected function auditLogger(): AuditLogger
    {
        return $this->audit;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{Thread, int}
     */
    public function fork(Comment $comment, User $actor, array $data, ?string $ip): array
    {
        $comment->loadMissing(['thread.document.workspace', 'thread.anchors']);
        $sourceThread = $comment->thread;
        $sourceThread->loadMissing(['comments' => fn ($query) => $query->orderBy('id')]);

        if ((int) $sourceThread->comments->sortBy('id')->first()?->id === (int) $comment->id) {
            $this->reject('comment_not_reply', 'Only replies can be forked into a new thread.', 'comment');
        }

        $idempotencyKey = (string) $data['idempotency_key'];
        $idempotencyAuthorId = (int) $comment->author_id;

        if ($existing = $this->idempotentCommentByAuthorId(
            $idempotencyAuthorId,
            $idempotencyKey,
            self::IDEMPOTENCY_SCOPE_FORK,
            (int) $comment->id,
        )) {
            return [$this->threads->loadThreadForResource($existing->thread), 200];
        }

        try {
            $thread = DB::transaction(function () use ($comment, $actor, $sourceThread, $idempotencyKey) {
                $thread = Thread::create([
                    'document_id' => $sourceThread->document_id,
                    'type' => $sourceThread->type,
                    'status' => ThreadStatus::Open,
                    'forked_from_comment_id' => $comment->id,
                    'created_by' => $actor->id,
                ]);

                $openingComment = $thread->comments()->create([
                    'author_id' => $comment->author_id,
                    'type' => $comment->type,
                    'body_md' => $comment->trashed() ? '' : $comment->body_md,
                    'proposed_text' => $comment->trashed() ? null : $comment->proposed_text,
                    'suggestion_status' => $comment->trashed() ? null : $comment->suggestion_status,
                    'client' => $comment->client,
                    'edited_at' => $comment->edited_at,
                    'idempotency_key' => $idempotencyKey,
                    'idempotency_scope' => self::IDEMPOTENCY_SCOPE_FORK,
                    'idempotency_scope_id' => $comment->id,
                ]);

                if ($comment->trashed()) {
                    $openingComment->forceFill(['deleted_at' => $comment->deleted_at ?? now()])->save();
                }

                foreach ($sourceThread->anchors as $anchor) {
                    $thread->anchors()->create(AnchorAttributes::fromAnchor($anchor));
                }

                return $thread;
            });
        } catch (QueryException $e) {
            $existing = $this->idempotentCommentAfterDuplicateByAuthorId(
                $e,
                $idempotencyAuthorId,
                $idempotencyKey,
                self::IDEMPOTENCY_SCOPE_FORK,
                (int) $comment->id,
            );

            return [$this->threads->loadThreadForResource($existing->thread), 200];
        }

        $this->recordEvent(
            'thread.forked',
            $sourceThread->document,
            $actor,
            $thread,
            $ip,
            [
                'source_thread_id' => $comment->thread_id,
                'source_comment_id' => $comment->id,
            ],
        );

        return [$this->threads->loadThreadForResource($thread), 201];
    }

    public function updateComment(Comment $comment, User $actor, string $body, ?string $ip): Comment
    {
        $comment->loadMissing('thread.document.workspace');

        if ($comment->trashed()) {
            $this->reject('comment_deleted', 'Deleted comments cannot be edited.', 'comment');
        }

        if ($comment->body_md === $body) {
            return $comment->load('author');
        }

        $comment->forceFill([
            'body_md' => $body,
            'edited_at' => now(),
        ])->save();

        $this->recordEvent('comment.edited', $comment->thread->document, $actor, $comment, $ip);

        $comment->refresh()->load('author');

        return $comment;
    }

    public function deleteComment(Comment $comment, User $actor, ?string $ip): void
    {
        $comment->loadMissing('thread.document.workspace');

        if ($comment->trashed()) {
            return;
        }

        // Keep the row as a tombstone so reply order and fork links stay navigable.
        $comment->forceFill([
            'body_md' => '',
            'proposed_text' => null,
            'suggestion_status' => null,
        ])->save();
        $comment->delete();

        $this->recordEvent('comment.deleted', $comment->thread->document, $actor, $comment, $ip);
    }

    public function updateSuggestionStatus(Comment $comment, User $actor, SuggestionStatus $status, ?string $ip): Comment
    {
        $comment->refresh();
        $comment->loadMissing('thread.document.workspace');

        if ($comment->trashed()) {
            $this->reject('comment_deleted', 'Deleted comments cannot be triaged as suggestions.', 'comment');
        }

        if ($comment->type !== CommentType::Suggestion) {
            $this->reject('comment_not_suggestion', 'Only suggested edits have a suggestion status.', 'comment');
        }

        $previousStatus = $comment->suggestion_status;
        if ($previousStatus === $status) {
            return $comment->load('author');
        }

        $comment->forceFill(['suggestion_status' => $status])->save();

        $this->recordEvent(
            $this->suggestionEventName($status),
            $comment->thread->document,
            $actor,
            $comment,
            $ip,
            [
                'previous_status' => $previousStatus?->value,
                'status' => $status->value,
            ],
        );

        return $comment->refresh()->load('author');
    }

    private function suggestionEventName(SuggestionStatus $status): string
    {
        return match ($status) {
            SuggestionStatus::Accepted => 'suggestion.accepted',
            SuggestionStatus::Declined => 'suggestion.declined',
            SuggestionStatus::Pending => 'suggestion.reopened',
        };
    }

    private function reject(string $code, string $message, string $field = 'anchor'): never
    {
        throw new HttpResponseException(response()->json([
            'message' => $message,
            'code' => $code,
            'errors' => [$field => [$code]],
        ], 422));
    }
}
