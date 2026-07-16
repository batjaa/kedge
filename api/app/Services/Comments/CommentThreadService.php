<?php

namespace App\Services\Comments;

use App\Enums\AnchorState;
use App\Enums\CommentClient;
use App\Enums\CommentType;
use App\Enums\DocumentStatus;
use App\Enums\ThreadStatus;
use App\Enums\ThreadType;
use App\Models\Anchor;
use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Thread;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Import\TextProjector;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Thread write/read coordinator. This is intentionally still one service for M2's
 * tracer path, but #62/#63 should move new suggestion/reply workflows into focused
 * collaborators before this grows another large branch.
 */
class CommentThreadService
{
    private const IDEMPOTENCY_SCOPE_DOCUMENT = 'document';

    private const IDEMPOTENCY_SCOPE_THREAD = 'thread';

    private const IDEMPOTENCY_SCOPE_FORK = 'fork-comment';

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly TextProjector $projector,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{Thread, int}
     */
    public function create(Document $document, User $author, array $data, ?string $ip): array
    {
        $idempotencyKey = (string) $data['idempotency_key'];
        if ($existing = $this->idempotentComment(
            $author,
            $idempotencyKey,
            self::IDEMPOTENCY_SCOPE_DOCUMENT,
            (int) $document->id,
        )) {
            return [$this->loadThreadForResource($existing->thread), 200];
        }

        $type = ThreadType::from((string) $data['type']);
        $version = $this->commentableVersion($document, includePlainText: $type === ThreadType::Inline);
        $anchor = $type === ThreadType::Inline
            ? $this->validatedAnchor($document, $version, (array) $data['anchor'])
            : null;

        if ($type === ThreadType::Document && (bool) ($data['failed_capture'] ?? false)) {
            Log::warning('anchor.capture_failed', [
                'document_id' => $document->id,
                'user_id' => $author->id,
            ]);
        }

        try {
            [$thread, $comment] = DB::transaction(function () use ($document, $author, $data, $type, $anchor, $version, $idempotencyKey) {
                $thread = Thread::create([
                    'document_id' => $document->id,
                    'type' => $type,
                    'status' => ThreadStatus::Open,
                    'created_by' => $author->id,
                ]);

                $comment = $thread->comments()->create([
                    'author_id' => $author->id,
                    'type' => CommentType::Comment,
                    'body_md' => (string) $data['body'],
                    'client' => CommentClient::Web,
                    'idempotency_key' => $idempotencyKey,
                    'idempotency_scope' => self::IDEMPOTENCY_SCOPE_DOCUMENT,
                    'idempotency_scope_id' => $document->id,
                ]);

                if ($anchor !== null) {
                    $thread->anchors()->create([
                        'document_version_id' => $version->id,
                        'exact' => $anchor['exact'],
                        'prefix' => $anchor['prefix'],
                        'suffix' => $anchor['suffix'],
                        'start' => $anchor['start'],
                        'end' => $anchor['end'],
                        'heading_path' => $anchor['heading_path'],
                        'projection_version' => $anchor['projection_version'],
                        'state' => AnchorState::Anchored,
                    ]);
                }

                return [$thread, $comment];
            });
        } catch (QueryException $e) {
            $existing = $this->idempotentCommentAfterDuplicate(
                $e,
                $author,
                $idempotencyKey,
                self::IDEMPOTENCY_SCOPE_DOCUMENT,
                (int) $document->id,
            );

            return [$this->loadThreadForResource($existing->thread), 200];
        }

        $this->recordThreadCreated($document, $author, $thread, $ip);
        $this->recordCommentCreated($document, $author, $comment, $ip);

        return [$this->loadThreadForResource($thread), 201];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{Comment, int}
     */
    public function reply(Thread $thread, User $author, array $data, ?string $ip): array
    {
        $idempotencyKey = (string) $data['idempotency_key'];
        if ($existing = $this->idempotentComment(
            $author,
            $idempotencyKey,
            self::IDEMPOTENCY_SCOPE_THREAD,
            (int) $thread->id,
        )) {
            return [$existing->load('author'), 200];
        }

        $thread->loadMissing('document');
        $this->commentableVersion($thread->document);

        try {
            $comment = DB::transaction(fn () => $thread->comments()->create([
                'author_id' => $author->id,
                'type' => CommentType::Comment,
                'body_md' => (string) $data['body'],
                'client' => CommentClient::Web,
                'idempotency_key' => $idempotencyKey,
                'idempotency_scope' => self::IDEMPOTENCY_SCOPE_THREAD,
                'idempotency_scope_id' => $thread->id,
            ]));
        } catch (QueryException $e) {
            $existing = $this->idempotentCommentAfterDuplicate(
                $e,
                $author,
                $idempotencyKey,
                self::IDEMPOTENCY_SCOPE_THREAD,
                (int) $thread->id,
            );

            return [$existing->load('author'), 200];
        }

        $this->recordCommentCreated($thread->document, $author, $comment, $ip);

        return [$comment->load('author'), 201];
    }

    public function updateStatus(Thread $thread, User $actor, ThreadStatus $status, ?string $ip): Thread
    {
        $thread->loadMissing('document.workspace');

        if ($thread->status === $status) {
            return $this->loadThreadForResource($thread);
        }

        $thread->forceFill(['status' => $status])->save();
        $thread->refresh();

        if ($status === ThreadStatus::Resolved) {
            $this->recordThreadResolved($thread->document, $actor, $thread, $ip);
        } else {
            $this->recordThreadReopened($thread->document, $actor, $thread, $ip);
        }

        return $this->loadThreadForResource($thread);
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

        $idempotencyKey = (string) ($data['idempotency_key'] ?? '');
        if ($existing = $this->idempotentComment(
            $actor,
            $idempotencyKey,
            self::IDEMPOTENCY_SCOPE_FORK,
            (int) $comment->id,
        )) {
            return [$this->loadThreadForResource($existing->thread), 200];
        }

        try {
            [$thread, $openingComment] = DB::transaction(function () use ($comment, $actor, $sourceThread, $idempotencyKey) {
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
                    'idempotency_key' => $idempotencyKey === '' ? null : $idempotencyKey,
                    'idempotency_scope' => $idempotencyKey === '' ? null : self::IDEMPOTENCY_SCOPE_FORK,
                    'idempotency_scope_id' => $idempotencyKey === '' ? null : $comment->id,
                ]);

                if ($comment->trashed()) {
                    $openingComment->forceFill(['deleted_at' => $comment->deleted_at ?? now()])->save();
                }

                foreach ($sourceThread->anchors as $anchor) {
                    $thread->anchors()->create([
                        'document_version_id' => $anchor->document_version_id,
                        'exact' => $anchor->exact,
                        'prefix' => $anchor->prefix,
                        'suffix' => $anchor->suffix,
                        'start' => $anchor->start,
                        'end' => $anchor->end,
                        'heading_path' => $anchor->heading_path,
                        'projection_version' => $anchor->projection_version,
                        'state' => $anchor->state,
                    ]);
                }

                return [$thread, $openingComment];
            });
        } catch (QueryException $e) {
            $existing = $this->idempotentCommentAfterDuplicate(
                $e,
                $actor,
                $idempotencyKey,
                self::IDEMPOTENCY_SCOPE_FORK,
                (int) $comment->id,
            );

            return [$this->loadThreadForResource($existing->thread), 200];
        }

        $this->recordThreadForked($sourceThread->document, $actor, $thread, $comment, $ip, (string) ($data['title'] ?? ''));

        return [$this->loadThreadForResource($thread), 201];
    }

    public function updateComment(Comment $comment, User $actor, string $body, ?string $ip): Comment
    {
        $comment->loadMissing('thread.document.workspace');

        if ($comment->trashed()) {
            $this->reject('comment_deleted', 'Deleted comments cannot be edited.', 'comment');
        }

        $comment->forceFill([
            'body_md' => $body,
            'edited_at' => now(),
        ])->save();

        $this->recordCommentEdited($comment->thread->document, $actor, $comment, $ip);

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

        $this->recordCommentDeleted($comment->thread->document, $actor, $comment, $ip);
    }

    /**
     * Rail read: one position-ordered aggregate query over threads, anchors, the
     * first comment, count, latest activity, and first author. Pagination remains
     * database-level; there are no per-thread lookups.
     *
     * @return LengthAwarePaginator<int, Thread>
     */
    public function listForDocument(Document $document, int $perPage): LengthAwarePaginator
    {
        $perPage = min(max($perPage, 1), 50);

        $stats = DB::table('comments')
            ->select('thread_id')
            ->selectRaw('COUNT(*) as comments_count')
            ->selectRaw('MAX(created_at) as latest_activity_at')
            ->groupBy('thread_id');

        $firstCommentIds = DB::table('comments')
            ->select('thread_id')
            ->selectRaw('MIN(id) as first_comment_id')
            ->groupBy('thread_id');

        $forkStats = DB::table('threads as forked_threads')
            ->join('comments as source_comments', 'source_comments.id', '=', 'forked_threads.forked_from_comment_id')
            ->select('source_comments.thread_id')
            ->selectRaw('COUNT(*) as forked_into_count')
            ->groupBy('source_comments.thread_id');

        $query = Thread::query()
            ->leftJoin('anchors as rail_anchors', 'rail_anchors.thread_id', '=', 'threads.id')
            ->leftJoinSub($stats, 'comment_stats', 'comment_stats.thread_id', '=', 'threads.id')
            ->leftJoinSub($firstCommentIds, 'first_comment_ids', 'first_comment_ids.thread_id', '=', 'threads.id')
            ->leftJoinSub($forkStats, 'fork_stats', 'fork_stats.thread_id', '=', 'threads.id')
            ->leftJoin('comments as first_comments', 'first_comments.id', '=', 'first_comment_ids.first_comment_id')
            ->leftJoin('users as first_authors', 'first_authors.id', '=', 'first_comments.author_id')
            ->where('threads.document_id', $document->id)
            ->select('threads.*')
            ->addSelect([
                'rail_anchors.id as rail_anchor_id',
                'rail_anchors.document_version_id as rail_anchor_document_version_id',
                'rail_anchors.exact as rail_anchor_exact',
                'rail_anchors.prefix as rail_anchor_prefix',
                'rail_anchors.suffix as rail_anchor_suffix',
                'rail_anchors.start as rail_anchor_start',
                'rail_anchors.end as rail_anchor_end',
                'rail_anchors.heading_path as rail_anchor_heading_path',
                'rail_anchors.projection_version as rail_anchor_projection_version',
                'rail_anchors.state as rail_anchor_state',
                'comment_stats.comments_count as comments_count',
                'comment_stats.latest_activity_at as latest_activity_at',
                'first_comments.id as first_comment_id',
                'first_comments.author_id as first_comment_author_id',
                'first_comments.type as first_comment_type',
                'first_comments.body_md as first_comment_body_md',
                'first_comments.proposed_text as first_comment_proposed_text',
                'first_comments.suggestion_status as first_comment_suggestion_status',
                'first_comments.client as first_comment_client',
                'first_comments.edited_at as first_comment_edited_at',
                'first_comments.deleted_at as first_comment_deleted_at',
                'first_comments.created_at as first_comment_created_at',
                'first_authors.name as first_author_name',
                'fork_stats.forked_into_count as forked_into_count',
            ])
            ->orderByRaw('case when threads.type = ? then 0 else 1 end', [ThreadType::Document->value])
            ->orderBy('rail_anchors.start')
            ->orderBy('threads.id');

        $paginator = $query->paginate($perPage);
        $threads = $paginator->getCollection()->transform(function (Thread $thread) use ($document) {
            $thread = $this->hydrateJoinedThread($thread);
            $thread->setRelation('document', $document);

            return $thread;
        });
        $this->hydrateCommentsForThreads($threads, $document);

        return $paginator;
    }

    private function commentableVersion(Document $document, bool $includePlainText = false): DocumentVersion
    {
        if ($document->isDemo()) {
            $this->reject('demo_document_unclaimed', 'Demo documents must be claimed before they can receive comments.', 'document');
        }

        if ($document->status !== DocumentStatus::Ready || $document->current_version_id === null) {
            $this->reject('document_not_ready', 'Only ready documents can receive comments.', 'document');
        }

        $this->loadCurrentVersion(
            $document,
            $includePlainText
                ? ['id', 'plain_text', 'projection_version']
                : ['id'],
        );

        if (! $document->currentVersion) {
            $this->reject('document_not_ready', 'Only ready documents can receive comments.', 'document');
        }

        return $document->currentVersion;
    }

    /**
     * @param  array<string, mixed>  $anchor
     * @return array{exact: string, prefix: ?string, suffix: ?string, start: int, end: int, heading_path: list<string>, projection_version: string}
     */
    private function validatedAnchor(Document $document, DocumentVersion $version, array $anchor): array
    {
        if ($version->plain_text === null || $version->projection_version === null) {
            $version = $this->refreshProjection($document, $version);
        }

        $matchesStored = $this->anchorExactMatches($version, $anchor);
        $needsFreshProjection = ! $matchesStored || ! $this->projectionIsCurrent($version);

        if ($needsFreshProjection) {
            $version = $this->refreshProjection($document, $version);
        }

        if (! $this->anchorExactMatches($version, $anchor)) {
            $this->reject(
                'anchor_document_changed',
                'The document changed since this text was selected. Re-select the text and try again.',
                'anchor.exact',
            );
        }

        return [
            'exact' => (string) $anchor['exact'],
            'prefix' => isset($anchor['prefix']) ? (string) $anchor['prefix'] : null,
            'suffix' => isset($anchor['suffix']) ? (string) $anchor['suffix'] : null,
            'start' => (int) $anchor['start'],
            'end' => (int) $anchor['end'],
            'heading_path' => array_values(array_filter((array) ($anchor['heading_path'] ?? []), 'is_string')),
            'projection_version' => (string) $version->projection_version,
        ];
    }

    private function anchorExactMatches(DocumentVersion $version, array $anchor): bool
    {
        if ($version->plain_text === null) {
            return false;
        }

        $plainText = (string) $version->plain_text;
        $start = (int) $anchor['start'];
        $end = (int) $anchor['end'];
        $length = mb_strlen($plainText, 'UTF-8');

        if ($start < 0 || $end <= $start || $end > $length) {
            return false;
        }

        return mb_substr($plainText, $start, $end - $start, 'UTF-8') === (string) $anchor['exact'];
    }

    private function refreshProjection(Document $document, DocumentVersion $version): DocumentVersion
    {
        $content = DocumentVersion::query()
            ->whereKey($version->id)
            ->value('content_normalized');

        $projection = $this->projector->project((string) $content, $document->format);

        $version->forceFill([
            'plain_text' => $projection->plainText,
            'projection_version' => $projection->projectionVersion,
        ])->save();

        return $version;
    }

    private function projectionIsCurrent(DocumentVersion $version): bool
    {
        $currentVersion = (string) config('kedge.projection.current_version', '');

        return $currentVersion === '' || (string) $version->projection_version === $currentVersion;
    }

    protected function idempotentComment(User $author, mixed $key, string $scope, int $scopeId): ?Comment
    {
        if (! is_string($key) || $key === '') {
            return null;
        }

        return Comment::query()
            ->withTrashed()
            ->where('author_id', $author->id)
            ->where('idempotency_key', $key)
            ->where('idempotency_scope', $scope)
            ->where('idempotency_scope_id', $scopeId)
            ->with(['author', 'thread'])
            ->first();
    }

    private function idempotentCommentAfterDuplicate(
        QueryException $exception,
        User $author,
        string $key,
        string $scope,
        int $scopeId,
    ): Comment {
        if (! $this->isDuplicateIdempotencyException($exception)) {
            throw $exception;
        }

        $existing = $this->idempotentComment($author, $key, $scope, $scopeId);
        if ($existing === null) {
            throw $exception;
        }

        return $existing;
    }

    private function isDuplicateIdempotencyException(QueryException $exception): bool
    {
        $code = (string) $exception->getCode();
        $message = $exception->getMessage();

        return in_array($code, ['23000', '23505'], true)
            || str_contains($message, 'comments_author_idempotency_scope_unique')
            || (str_contains($message, 'comments') && str_contains($message, 'idempotency'));
    }

    /**
     * @param  list<string>  $columns
     */
    private function loadCurrentVersion(Document $document, array $columns): void
    {
        $columns = array_values(array_unique(['id', ...$columns]));
        if ($this->currentVersionHasColumns($document, $columns)) {
            return;
        }

        $document->unsetRelation('currentVersion');
        $document->load([
            'currentVersion' => fn ($query) => $query->select($columns),
        ]);
    }

    /**
     * @param  list<string>  $columns
     */
    private function currentVersionHasColumns(Document $document, array $columns): bool
    {
        if (! $document->relationLoaded('currentVersion')) {
            return false;
        }

        $version = $document->getRelation('currentVersion');
        if (! $version instanceof DocumentVersion) {
            return false;
        }

        $attributes = $version->getAttributes();

        foreach ($columns as $column) {
            if (! array_key_exists($column, $attributes)) {
                return false;
            }
        }

        return true;
    }

    private function loadThreadForResource(Thread $thread): Thread
    {
        $thread->load([
            'document.workspace',
            'anchors' => fn ($query) => $query->orderBy('start'),
            'comments' => fn ($query) => $query->with('author')->orderBy('id'),
        ]);
        $thread->comments->each(fn (Comment $comment) => $comment->setRelation('thread', $thread));

        $firstComment = $thread->comments->sortBy('id')->first();
        if ($firstComment) {
            $thread->setRelation('firstComment', $firstComment);
        }

        $anchor = $thread->anchors->first();
        if ($anchor) {
            $thread->setRelation('railAnchor', $anchor);
        }

        $thread->setAttribute('comments_count', $thread->comments->count());
        $thread->setAttribute('latest_activity_at', $thread->comments->max('created_at'));
        $forkedIntoThreads = Thread::query()
            ->whereIn('forked_from_comment_id', $thread->comments->pluck('id'))
            ->orderBy('id')
            ->get();
        $thread->setRelation('forkedIntoThreads', $forkedIntoThreads);
        $thread->setAttribute('forked_into_count', $forkedIntoThreads->count());

        return $thread;
    }

    private function hydrateCommentsForThreads($threads, Document $document): void
    {
        $threadIds = $threads->pluck('id')->filter()->values();
        if ($threadIds->isEmpty()) {
            return;
        }

        $commentsByThread = Comment::withTrashed()
            ->whereIn('thread_id', $threadIds)
            ->with('author')
            ->orderBy('id')
            ->get()
            ->groupBy('thread_id');
        $commentThreadMap = $commentsByThread
            ->flatten(1)
            ->mapWithKeys(fn (Comment $comment) => [(int) $comment->id => (int) $comment->thread_id]);
        $forksBySourceThread = Thread::query()
            ->whereIn('forked_from_comment_id', $commentThreadMap->keys())
            ->orderBy('id')
            ->get()
            ->groupBy(fn (Thread $thread) => $commentThreadMap->get((int) $thread->forked_from_comment_id, 0));

        $threads->each(function (Thread $thread) use ($commentsByThread, $document, $forksBySourceThread) {
            $thread->setRelation('document', $document);
            $comments = $commentsByThread->get($thread->id, collect())->values();
            $comments->each(fn (Comment $comment) => $comment->setRelation('thread', $thread));
            $thread->setRelation('comments', $comments);
            $forkedIntoThreads = $forksBySourceThread->get($thread->id, collect())->values();
            $thread->setRelation('forkedIntoThreads', $forkedIntoThreads);
            $thread->setAttribute('forked_into_count', $forkedIntoThreads->count());

            $firstComment = $comments->first();
            if ($firstComment instanceof Comment) {
                $thread->setRelation('firstComment', $firstComment);
            }
        });
    }

    private function hydrateJoinedThread(Thread $thread): Thread
    {
        if ($thread->rail_anchor_id !== null) {
            $anchor = new Anchor;
            $anchor->setRawAttributes([
                'id' => $thread->rail_anchor_id,
                'thread_id' => $thread->id,
                'document_version_id' => $thread->rail_anchor_document_version_id,
                'exact' => $thread->rail_anchor_exact,
                'prefix' => $thread->rail_anchor_prefix,
                'suffix' => $thread->rail_anchor_suffix,
                'start' => $thread->rail_anchor_start,
                'end' => $thread->rail_anchor_end,
                'heading_path' => $thread->rail_anchor_heading_path,
                'projection_version' => $thread->rail_anchor_projection_version,
                'state' => $thread->rail_anchor_state,
            ], true);
            $thread->setRelation('railAnchor', $anchor);
        }

        if ($thread->first_comment_id !== null) {
            $comment = new Comment;
            $comment->setRawAttributes([
                'id' => $thread->first_comment_id,
                'thread_id' => $thread->id,
                'author_id' => $thread->first_comment_author_id,
                'type' => $thread->first_comment_type,
                'body_md' => $thread->first_comment_body_md,
                'proposed_text' => $thread->first_comment_proposed_text,
                'suggestion_status' => $thread->first_comment_suggestion_status,
                'client' => $thread->first_comment_client,
                'edited_at' => $thread->first_comment_edited_at,
                'deleted_at' => $thread->first_comment_deleted_at,
                'created_at' => $thread->first_comment_created_at,
            ], true);

            $author = new User;
            $author->setRawAttributes([
                'id' => $thread->first_comment_author_id,
                'name' => $thread->first_author_name,
            ], true);
            $comment->setRelation('author', $author);
            $thread->setRelation('firstComment', $comment);
        }

        return $thread;
    }

    private function recordThreadCreated(Document $document, User $author, Thread $thread, ?string $ip): void
    {
        Log::info('thread.created', [
            'document_id' => $document->id,
            'thread_id' => $thread->id,
            'user_id' => $author->id,
        ]);

        $this->audit->record($document->workspace, $author, 'thread.created', $thread, ip: $ip);
    }

    private function recordCommentCreated(Document $document, User $author, Comment $comment, ?string $ip): void
    {
        Log::info('comment.created', [
            'document_id' => $document->id,
            'thread_id' => $comment->thread_id,
            'comment_id' => $comment->id,
            'user_id' => $author->id,
        ]);

        $this->audit->record($document->workspace, $author, 'comment.created', $comment, ip: $ip);
    }

    private function recordThreadResolved(Document $document, User $actor, Thread $thread, ?string $ip): void
    {
        Log::info('thread.resolved', [
            'document_id' => $document->id,
            'thread_id' => $thread->id,
            'user_id' => $actor->id,
        ]);

        $this->audit->record($document->workspace, $actor, 'thread.resolved', $thread, ip: $ip);
    }

    private function recordThreadReopened(Document $document, User $actor, Thread $thread, ?string $ip): void
    {
        Log::info('thread.reopened', [
            'document_id' => $document->id,
            'thread_id' => $thread->id,
            'user_id' => $actor->id,
        ]);

        $this->audit->record($document->workspace, $actor, 'thread.reopened', $thread, ip: $ip);
    }

    private function recordThreadForked(
        Document $document,
        User $actor,
        Thread $thread,
        Comment $sourceComment,
        ?string $ip,
        string $title,
    ): void {
        Log::info('thread.forked', [
            'document_id' => $document->id,
            'thread_id' => $thread->id,
            'source_thread_id' => $sourceComment->thread_id,
            'source_comment_id' => $sourceComment->id,
            'user_id' => $actor->id,
        ]);

        $meta = [
            'source_thread_id' => $sourceComment->thread_id,
            'source_comment_id' => $sourceComment->id,
        ];

        if ($title !== '') {
            $meta['title'] = $title;
        }

        $this->audit->record($document->workspace, $actor, 'thread.forked', $thread, $meta, ip: $ip);
    }

    private function recordCommentEdited(Document $document, User $actor, Comment $comment, ?string $ip): void
    {
        Log::info('comment.edited', [
            'document_id' => $document->id,
            'thread_id' => $comment->thread_id,
            'comment_id' => $comment->id,
            'user_id' => $actor->id,
        ]);

        $this->audit->record($document->workspace, $actor, 'comment.edited', $comment, ip: $ip);
    }

    private function recordCommentDeleted(Document $document, User $actor, Comment $comment, ?string $ip): void
    {
        Log::info('comment.deleted', [
            'document_id' => $document->id,
            'thread_id' => $comment->thread_id,
            'comment_id' => $comment->id,
            'user_id' => $actor->id,
        ]);

        $this->audit->record($document->workspace, $actor, 'comment.deleted', $comment, ip: $ip);
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
