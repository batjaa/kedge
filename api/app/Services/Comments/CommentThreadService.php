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
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CommentThreadService
{
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
        if ($existing = $this->idempotentComment($author, $data['idempotency_key'] ?? null)) {
            return [$this->loadThreadForResource($existing->thread), 200];
        }

        $document->loadMissing(['workspace', 'currentVersion']);
        $version = $this->commentableVersion($document);
        $type = ThreadType::from((string) $data['type']);
        $anchor = $type === ThreadType::Inline
            ? $this->validatedAnchor($document, $version, (array) $data['anchor'])
            : null;

        if ($type === ThreadType::Document && (bool) ($data['failed_capture'] ?? false)) {
            Log::warning('anchor.capture_failed', [
                'document_id' => $document->id,
                'user_id' => $author->id,
            ]);
        }

        [$thread, $comment] = DB::transaction(function () use ($document, $author, $data, $type, $anchor, $version) {
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
                'idempotency_key' => $data['idempotency_key'] ?? null,
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
        if ($existing = $this->idempotentComment($author, $data['idempotency_key'])) {
            return [$existing->load('author'), 200];
        }

        $thread->loadMissing('document.workspace');
        $this->commentableVersion($thread->document);

        $comment = DB::transaction(fn () => $thread->comments()->create([
            'author_id' => $author->id,
            'type' => CommentType::Comment,
            'body_md' => (string) $data['body'],
            'client' => CommentClient::Web,
            'idempotency_key' => $data['idempotency_key'],
        ]));

        $this->recordCommentCreated($thread->document, $author, $comment, $ip);

        return [$comment->load('author'), 201];
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
        $document->loadMissing('currentVersion');
        $versionId = $document->current_version_id;
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

        $query = Thread::query()
            ->leftJoin('anchors as rail_anchors', function ($join) use ($versionId): void {
                $join->on('rail_anchors.thread_id', '=', 'threads.id')
                    ->where('rail_anchors.document_version_id', '=', $versionId);
            })
            ->leftJoinSub($stats, 'comment_stats', 'comment_stats.thread_id', '=', 'threads.id')
            ->leftJoinSub($firstCommentIds, 'first_comment_ids', 'first_comment_ids.thread_id', '=', 'threads.id')
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
                'first_comments.created_at as first_comment_created_at',
                'first_authors.name as first_author_name',
            ])
            ->orderByRaw('case when threads.type = ? then 0 else 1 end', [ThreadType::Document->value])
            ->orderBy('rail_anchors.start')
            ->orderBy('threads.id');

        $paginator = $query->paginate($perPage);
        $paginator->getCollection()->transform(fn (Thread $thread) => $this->hydrateJoinedThread($thread));

        return $paginator;
    }

    private function commentableVersion(Document $document): DocumentVersion
    {
        if ($document->isDemo()) {
            $this->reject('demo_document_unclaimed', 'Demo documents must be claimed before they can receive comments.', 'document');
        }

        if ($document->status !== DocumentStatus::Ready || ! $document->currentVersion) {
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

        $anchorProjectionVersion = (string) $anchor['projection_version'];
        if ($anchorProjectionVersion !== (string) $version->projection_version) {
            $version = $this->refreshProjection($document, $version);

            if ($anchorProjectionVersion !== (string) $version->projection_version) {
                $this->reject(
                    'anchor_projection_version_mismatch',
                    'The selected text was captured against a different projection version.',
                );
            }
        }

        if (! $this->anchorExactMatches($version, $anchor)) {
            $previousPlainText = $version->plain_text;
            $previousProjectionVersion = $version->projection_version;
            $version = $this->refreshProjection($document, $version);

            $selfHealed = $version->plain_text !== $previousPlainText
                || $version->projection_version !== $previousProjectionVersion;

            if (! $selfHealed || ! $this->anchorExactMatches($version, $anchor)) {
                $this->reject(
                    'anchor_exact_mismatch',
                    'The selected text no longer matches the document projection.',
                    'anchor.exact',
                );
            }
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
        $plainText = (string) $version->plain_text;
        $start = (int) $anchor['start'];
        $end = (int) $anchor['end'];
        $length = mb_strlen($plainText, 'UTF-8');

        if ($start < 0 || $end <= $start || $end > $length) {
            $this->reject('anchor_offsets_invalid', 'The selected text offsets are outside the document projection.');
        }

        return mb_substr($plainText, $start, $end - $start, 'UTF-8') === (string) $anchor['exact'];
    }

    private function refreshProjection(Document $document, DocumentVersion $version): DocumentVersion
    {
        $projection = $this->projector->project($version->content_normalized, $document->format);

        $version->forceFill([
            'plain_text' => $projection->plainText,
            'projection_version' => $projection->projectionVersion,
        ])->save();

        return $version->refresh();
    }

    private function idempotentComment(User $author, mixed $key): ?Comment
    {
        if (! is_string($key) || $key === '') {
            return null;
        }

        return Comment::query()
            ->where('author_id', $author->id)
            ->where('idempotency_key', $key)
            ->with(['author', 'thread.document.currentVersion'])
            ->first();
    }

    private function loadThreadForResource(Thread $thread): Thread
    {
        $thread->load([
            'anchors' => fn ($query) => $query->orderBy('start'),
            'comments' => fn ($query) => $query->with('author')->orderBy('id'),
        ]);

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

        return $thread;
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

    private function reject(string $code, string $message, string $field = 'anchor'): never
    {
        throw new HttpResponseException(response()->json([
            'message' => $message,
            'code' => $code,
            'errors' => [$field => [$code]],
        ], 422));
    }
}
