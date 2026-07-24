<?php

namespace App\Services\Comments;

use App\Enums\AuditEvent;
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
        private readonly CommentMentionService $mentions,
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
        $comment->loadMissing(['author', 'thread.document.workspace', 'thread.anchors']);
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
            return [$this->threads->loadThreadForResource($existing->thread, $actor), 200];
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

                $openingComment = $thread->comments()->create($this->threads->commentAttributes(
                    $comment->author,
                    $comment->type,
                    [
                        'body' => $comment->trashed() ? '' : $comment->body_md,
                        'proposed_text' => $comment->trashed() ? null : $comment->proposed_text,
                        'suggestion_status' => $comment->trashed() ? null : $comment->suggestion_status,
                        'client' => $comment->client,
                        'edited_at' => $comment->edited_at,
                    ],
                    $idempotencyKey,
                    self::IDEMPOTENCY_SCOPE_FORK,
                    (int) $comment->id,
                ));

                if ($comment->trashed()) {
                    $openingComment->forceFill(['deleted_at' => $comment->deleted_at ?? now()])->save();
                } else {
                    $this->mentions->copyMentionLinks($comment, $openingComment);
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

            return [$this->threads->loadThreadForResource($existing->thread, $actor), 200];
        }

        $this->recordEvent(
            AuditEvent::ThreadForked,
            $sourceThread->document,
            $actor,
            $thread,
            $ip,
            [
                'source_thread_id' => $comment->thread_id,
                'source_comment_id' => $comment->id,
            ],
        );

        return [$this->threads->loadThreadForResource($thread, $actor), 201];
    }

    public function updateComment(Comment $comment, User $actor, string $body, ?string $ip): Comment
    {
        $comment->loadMissing('thread.document.workspace');
        $document = $comment->thread->document;

        if ($comment->trashed()) {
            $this->reject('comment_deleted', 'Deleted comments cannot be edited.', 'comment');
        }

        if ($comment->body_md === $body) {
            return $comment->load(['author', 'mentionedUsers']);
        }

        DB::transaction(function () use ($comment, $document, $actor, $body): void {
            $this->mentions->syncForUpdatedComment($comment, $document, $actor, $body);

            $comment->forceFill([
                'body_md' => $body,
                'edited_at' => now(),
            ])->save();
        });

        $this->recordEvent(AuditEvent::CommentEdited, $document, $actor, $comment, $ip);

        $comment->refresh()->load(['author', 'mentionedUsers']);

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
        $comment->mentionedUsers()->sync([]);
        $comment->delete();

        $this->recordEvent(AuditEvent::CommentDeleted, $comment->thread->document, $actor, $comment, $ip);
    }

    public function updateSuggestionStatus(Comment $comment, User $actor, SuggestionStatus $status, ?string $ip): Comment
    {
        /** @var array{Comment, ?SuggestionStatus, bool} $result */
        $result = DB::transaction(function () use ($comment, $status): array {
            $lockedComment = Comment::withTrashed()
                ->whereKey($comment->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedComment->load('thread.document.workspace');

            if ($lockedComment->trashed()) {
                $this->reject('comment_deleted', 'Deleted comments cannot be triaged as suggestions.', 'comment');
            }

            if ($lockedComment->type !== CommentType::Suggestion) {
                $this->reject('comment_not_suggestion', 'Only suggested edits have a suggestion status.', 'comment');
            }

            $previousStatus = $lockedComment->suggestion_status;
            if ($previousStatus === $status) {
                return [$lockedComment->load(['author', 'mentionedUsers']), $previousStatus, false];
            }

            $lockedComment->forceFill(['suggestion_status' => $status])->save();

            return [$lockedComment, $previousStatus, true];
        });

        [$lockedComment, $previousStatus, $changed] = $result;

        if (! $changed) {
            return $lockedComment;
        }

        // Post-commit: the triage has landed. Emitting the event here — never
        // inside the transaction above — keeps a failing audit write from rolling
        // the triage back (a mid-transaction insert error poisons the whole
        // transaction on Postgres even when recordSafely swallows it).
        $this->recordEvent(
            $this->suggestionEventName($status),
            $lockedComment->thread->document,
            $actor,
            $lockedComment,
            $ip,
            [
                'previous_status' => $previousStatus?->value,
                'status' => $status->value,
            ],
        );

        return $lockedComment->refresh()->load(['author', 'mentionedUsers']);
    }

    private function suggestionEventName(SuggestionStatus $status): AuditEvent
    {
        return match ($status) {
            SuggestionStatus::Accepted => AuditEvent::SuggestionAccepted,
            SuggestionStatus::Declined => AuditEvent::SuggestionDeclined,
            SuggestionStatus::Pending => AuditEvent::SuggestionReopened,
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
