<?php

namespace App\Services\Comments;

use App\Enums\CommentClient;
use App\Enums\CommentType;
use App\Enums\DocumentStatus;
use App\Enums\SuggestionStatus;
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
 * Thread write/read coordinator for creation, replies, status changes, and the
 * rail list. Comment moderation lives in CommentModerationService.
 */
class CommentThreadService
{
    use RecordsCommentEvents;
    use ResolvesIdempotentComments;

    private const IDEMPOTENCY_SCOPE_DOCUMENT = 'document';

    private const IDEMPOTENCY_SCOPE_THREAD = 'thread';

    private readonly AuditLogger $audit;

    private readonly TextProjector $projector;

    private readonly CommentMentionService $mentions;

    public function __construct(
        AuditLogger $audit,
        TextProjector $projector,
        ?CommentMentionService $mentions = null,
    ) {
        $this->audit = $audit;
        $this->projector = $projector;
        $this->mentions = $mentions ?? app(CommentMentionService::class);
    }

    protected function auditLogger(): AuditLogger
    {
        return $this->audit;
    }

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
            return [$this->loadThreadForResource($existing->thread, $author), 200];
        }

        $type = ThreadType::from((string) $data['type']);
        $commentType = CommentType::from((string) ($data['comment_type'] ?? CommentType::Comment->value));
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
            [$thread, $comment] = DB::transaction(function () use ($document, $author, $data, $type, $commentType, $anchor, $version, $idempotencyKey) {
                $thread = Thread::create([
                    'document_id' => $document->id,
                    'type' => $type,
                    'status' => ThreadStatus::Open,
                    'created_by' => $author->id,
                ]);

                $comment = $thread->comments()->create($this->commentAttributes(
                    $author,
                    $commentType,
                    $data,
                    $idempotencyKey,
                    self::IDEMPOTENCY_SCOPE_DOCUMENT,
                    (int) $document->id,
                ));
                $this->mentions->syncForComment($comment, $document, $author);

                if ($anchor !== null) {
                    $thread->anchors()->create(AnchorAttributes::fromCapture($anchor, $version));
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

            return [$this->loadThreadForResource($existing->thread, $author), 200];
        }

        $this->recordEvent('thread.created', $document, $author, $thread, $ip);
        $this->recordEvent('comment.created', $document, $author, $comment, $ip);

        return [$this->loadThreadForResource($thread, $author), 201];
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
            return [$this->loadCommentForResource($existing, $author), 200];
        }

        $thread->loadMissing('document');
        $type = CommentType::from((string) ($data['comment_type'] ?? CommentType::Comment->value));
        $this->commentableVersion($thread->document);

        try {
            $comment = DB::transaction(function () use ($thread, $author, $type, $data, $idempotencyKey) {
                $comment = $thread->comments()->create($this->commentAttributes(
                    $author,
                    $type,
                    $data,
                    $idempotencyKey,
                    self::IDEMPOTENCY_SCOPE_THREAD,
                    (int) $thread->id,
                ));
                $this->mentions->syncForComment($comment, $thread->document, $author);

                return $comment;
            });
        } catch (QueryException $e) {
            $existing = $this->idempotentCommentAfterDuplicate(
                $e,
                $author,
                $idempotencyKey,
                self::IDEMPOTENCY_SCOPE_THREAD,
                (int) $thread->id,
            );

            return [$this->loadCommentForResource($existing, $author), 200];
        }

        $this->recordEvent('comment.created', $thread->document, $author, $comment, $ip);

        return [$this->loadCommentForResource($comment, $author), 201];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function commentAttributes(
        User $author,
        CommentType $type,
        array $data,
        string $idempotencyKey,
        string $scope,
        int $scopeId,
    ): array {
        $attributes = [
            'author_id' => $author->id,
            'type' => $type,
            'body_md' => (string) ($data['body'] ?? ''),
            'proposed_text' => $type === CommentType::Suggestion && array_key_exists('proposed_text', $data)
                ? $data['proposed_text']
                : null,
            'suggestion_status' => $type === CommentType::Suggestion
                ? (array_key_exists('suggestion_status', $data) ? $data['suggestion_status'] : SuggestionStatus::Pending)
                : null,
            'client' => $data['client'] ?? CommentClient::Web,
            'idempotency_key' => $idempotencyKey,
            'idempotency_scope' => $scope,
            'idempotency_scope_id' => $scopeId,
        ];

        if (array_key_exists('edited_at', $data)) {
            $attributes['edited_at'] = $data['edited_at'];
        }

        return $attributes;
    }

    public function updateStatus(Thread $thread, User $actor, ThreadStatus $status, ?string $ip): Thread
    {
        $thread->loadMissing('document.workspace');

        if ($thread->status === $status) {
            return $this->loadThreadForResource($thread, $actor);
        }

        $thread->forceFill(['status' => $status])->save();
        $thread->refresh();

        if ($status === ThreadStatus::Resolved) {
            $this->recordEvent('thread.resolved', $thread->document, $actor, $thread, $ip);
        } else {
            $this->recordEvent('thread.reopened', $thread->document, $actor, $thread, $ip);
        }

        return $this->loadThreadForResource($thread, $actor);
    }

    /**
     * Rail read: one position-ordered aggregate query over threads, anchors,
     * count, and latest activity. Comments and fork counts are bulk-hydrated
     * once after pagination so soft-deleted comments stay coherent.
     *
     * @return LengthAwarePaginator<int, Thread>
     */
    public function listForDocument(Document $document, int $perPage, ?User $viewer = null): LengthAwarePaginator
    {
        $perPage = min(max($perPage, 1), 50);

        $stats = DB::table('comments')
            ->select('thread_id')
            ->selectRaw('COUNT(*) as comments_count')
            ->selectRaw('MAX(created_at) as latest_activity_at')
            ->groupBy('thread_id');

        $query = Thread::query()
            ->leftJoin('anchors as rail_anchors', 'rail_anchors.thread_id', '=', 'threads.id')
            ->leftJoinSub($stats, 'comment_stats', 'comment_stats.thread_id', '=', 'threads.id')
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
        $this->hydrateCommentsForThreads($threads, $document, $viewer);

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
        return $this->idempotentCommentByAuthorId((int) $author->id, $key, $scope, $scopeId);
    }

    private function idempotentCommentAfterDuplicate(
        QueryException $exception,
        User $author,
        string $key,
        string $scope,
        int $scopeId,
    ): Comment {
        return $this->idempotentCommentAfterDuplicateByAuthorId(
            $exception,
            (int) $author->id,
            $key,
            $scope,
            $scopeId,
        );
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

    public function loadThreadForResource(Thread $thread, ?User $viewer = null): Thread
    {
        $thread->load([
            'document.workspace',
            'anchors' => fn ($query) => $query->orderBy('start'),
            'comments' => fn ($query) => $query->with('author')->orderBy('id'),
        ]);
        $thread->comments->each(fn (Comment $comment) => $comment->setRelation('thread', $thread));
        $this->applyReactionAttributes($thread->comments, $viewer);

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

    public function loadCommentForResource(Comment $comment, ?User $viewer = null): Comment
    {
        $comment->load(['author', 'thread.document']);
        $this->applyReactionAttributes(collect([$comment]), $viewer);

        return $comment;
    }

    private function hydrateCommentsForThreads($threads, Document $document, ?User $viewer): void
    {
        $threadIds = $threads->pluck('id')->filter()->values();
        if ($threadIds->isEmpty()) {
            return;
        }

        $reactionStats = DB::table('comment_reactions')
            ->select('comment_id')
            ->selectRaw('COUNT(*) as reaction_count')
            ->where('emoji', CommentReactionService::THUMBS_UP)
            ->groupBy('comment_id');

        $commentsQuery = Comment::withTrashed()
            ->whereIn('thread_id', $threadIds)
            ->leftJoinSub($reactionStats, 'reaction_stats', 'reaction_stats.comment_id', '=', 'comments.id')
            ->select('comments.*')
            ->addSelect('reaction_stats.reaction_count as reaction_count')
            ->with('author')
            ->orderBy('comments.id');

        if ($viewer instanceof User) {
            $viewerReactions = DB::table('comment_reactions')
                ->select('comment_id')
                ->where('user_id', $viewer->id)
                ->where('emoji', CommentReactionService::THUMBS_UP);

            $commentsQuery
                ->leftJoinSub($viewerReactions, 'viewer_reactions', 'viewer_reactions.comment_id', '=', 'comments.id')
                ->selectRaw('CASE WHEN viewer_reactions.comment_id IS NULL THEN 0 ELSE 1 END as viewer_has_reacted');
        } else {
            $commentsQuery->selectRaw('0 as viewer_has_reacted');
        }

        $commentsByThread = $commentsQuery->get()
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

        return $thread;
    }

    private function applyReactionAttributes($comments, ?User $viewer): void
    {
        $commentIds = $comments->pluck('id')->filter()->values();
        if ($commentIds->isEmpty()) {
            return;
        }

        $counts = DB::table('comment_reactions')
            ->select('comment_id')
            ->selectRaw('COUNT(*) as reaction_count')
            ->whereIn('comment_id', $commentIds)
            ->where('emoji', CommentReactionService::THUMBS_UP)
            ->groupBy('comment_id')
            ->pluck('reaction_count', 'comment_id');
        $viewerReacted = $viewer instanceof User
            ? DB::table('comment_reactions')
                ->whereIn('comment_id', $commentIds)
                ->where('user_id', $viewer->id)
                ->where('emoji', CommentReactionService::THUMBS_UP)
                ->pluck('comment_id')
                ->mapWithKeys(fn (mixed $id) => [(int) $id => true])
            : collect();

        $comments->each(function (Comment $comment) use ($counts, $viewerReacted): void {
            $comment->setAttribute('reaction_count', (int) ($counts[$comment->id] ?? 0));
            $comment->setAttribute('viewer_has_reacted', (bool) ($viewerReacted[(int) $comment->id] ?? false));
        });
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
