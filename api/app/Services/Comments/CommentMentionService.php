<?php

namespace App\Services\Comments;

use App\Models\Comment;
use App\Models\Document;
use App\Models\ShareParticipant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CommentMentionService
{
    // Persisted mention token format: [@Label](mention:id). Keep in sync with
    // web/lib/mention-tokens.ts and web/lib/render-comment-markdown.tsx.
    private const TOKEN_PATTERN = '/\[@[^\]\r\n]{1,120}\]\(mention:(\d+)\)/u';

    /**
     * @return Collection<int, User>
     */
    public function suggestions(Document $document, User $actor, string $query, int $limit = 8): Collection
    {
        $term = Str::lower(trim($query));

        return $this->audienceQuery($document, $actor)
            ->when($term !== '', function (Builder $query) use ($term): void {
                $query->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", ['%'.$this->escapeLike($term).'%']);
            })
            ->select(['users.id', 'users.name'])
            ->orderBy('users.name')
            ->orderBy('users.id')
            ->limit(min(max($limit, 1), 20))
            ->get();
    }

    public function syncForComment(Comment $comment, Document $document, User $actor): void
    {
        $ids = $this->mentionedUserIds((string) $comment->body_md);
        $this->assertAllowed($document, $actor, $ids);

        $comment->mentionedUsers()->sync($ids);
    }

    public function syncForUpdatedComment(Comment $comment, Document $document, User $actor, string $body): void
    {
        $ids = $this->mentionedUserIds($body);
        $newIds = array_values(array_diff($ids, $this->linkedMentionIds($comment)));
        $this->assertAllowed($document, $actor, $newIds);

        $comment->mentionedUsers()->sync($ids);
    }

    public function copyMentionLinks(Comment $source, Comment $target): void
    {
        $rows = DB::table('comment_mentions')
            ->where('comment_id', $source->id)
            ->get(['user_id'])
            ->map(fn (object $row) => [
                'comment_id' => $target->id,
                'user_id' => $row->user_id,
            ])
            ->all();

        if ($rows !== []) {
            DB::table('comment_mentions')->insertOrIgnore($rows);
        }
    }

    /**
     * @return list<int>
     */
    public function mentionedUserIds(string $body): array
    {
        if (! preg_match_all(self::TOKEN_PATTERN, $body, $matches)) {
            return [];
        }

        return collect($matches[1])
            ->map(fn (string $id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<int>  $ids
     */
    private function assertAllowed(Document $document, User $actor, array $ids): void
    {
        if ($ids === []) {
            return;
        }

        $allowed = $this->audienceQuery($document, $actor)
            ->whereIn('users.id', $ids)
            ->pluck('users.id')
            ->map(fn (mixed $id) => (int) $id)
            ->all();

        $missing = array_values(array_diff($ids, $allowed));
        if ($missing === []) {
            return;
        }

        throw new HttpResponseException(response()->json([
            'message' => 'One or more mentions are outside your visible audience for this document.',
            'code' => 'mention_out_of_audience',
            'errors' => ['body' => ['mention_out_of_audience']],
        ], 422));
    }

    /**
     * @return Builder<User>
     */
    private function audienceQuery(Document $document, User $actor): Builder
    {
        if ($this->isWorkspaceMember($document, $actor)) {
            return $this->workspaceMemberAudience($document, $actor);
        }

        $participant = $this->activeShareParticipant($document, $actor);
        if ($participant instanceof ShareParticipant) {
            return $this->reviewerAudience($document, $actor, $participant);
        }

        return User::query()->whereRaw('1 = 0');
    }

    private function isWorkspaceMember(Document $document, User $actor): bool
    {
        return $actor->workspaces()
            ->whereKey($document->workspace_id)
            ->exists();
    }

    private function activeShareParticipant(Document $document, User $actor): ?ShareParticipant
    {
        return ShareParticipant::query()
            ->where('user_id', $actor->id)
            ->whereNotNull('verified_at')
            ->whereHas('share', function (Builder $query) use ($document): void {
                $query->where('document_id', $document->id)
                    ->active();
            })
            ->orderBy('id')
            ->first(['id', 'share_id', 'user_id']);
    }

    /**
     * @return Builder<User>
     */
    private function workspaceMemberAudience(Document $document, User $actor): Builder
    {
        $workspaceMembers = DB::table('workspace_members')
            ->select('user_id')
            ->where('workspace_id', $document->workspace_id);
        $verifiedShareParticipants = DB::table('share_participants')
            ->join('shares', 'shares.id', '=', 'share_participants.share_id')
            ->select('share_participants.user_id')
            ->whereNotNull('share_participants.verified_at')
            ->where('shares.document_id', $document->id)
            ->whereNull('shares.revoked_at')
            ->where(function ($query): void {
                $query->whereNull('shares.expires_at')
                    ->orWhere('shares.expires_at', '>', now());
            });
        $commentAuthors = $this->commentAuthorsForDocument($document);

        return User::query()
            ->where('users.id', '!=', $actor->id)
            ->where(function (Builder $query) use ($workspaceMembers, $verifiedShareParticipants, $commentAuthors): void {
                $query->whereIn('users.id', $workspaceMembers)
                    ->orWhereIn('users.id', $verifiedShareParticipants)
                    ->orWhereIn('users.id', $commentAuthors);
            });
    }

    /**
     * @return Builder<User>
     */
    private function reviewerAudience(Document $document, User $actor, ShareParticipant $participant): Builder
    {
        $sameShareParticipants = DB::table('share_participants')
            ->select('user_id')
            ->where('share_id', $participant->share_id)
            ->whereNotNull('verified_at');
        $commentAuthors = $this->commentAuthorsForDocument($document);

        return User::query()
            ->where('users.id', '!=', $actor->id)
            ->where(function (Builder $query) use ($sameShareParticipants, $commentAuthors): void {
                $query->whereIn('users.id', $sameShareParticipants)
                    ->orWhereIn('users.id', $commentAuthors);
            });
    }

    private function commentAuthorsForDocument(Document $document)
    {
        return DB::table('comments')
            ->join('threads', 'threads.id', '=', 'comments.thread_id')
            ->select('comments.author_id')
            ->where('threads.document_id', $document->id);
    }

    /**
     * @return list<int>
     */
    private function linkedMentionIds(Comment $comment): array
    {
        return DB::table('comment_mentions')
            ->where('comment_id', $comment->id)
            ->pluck('user_id')
            ->map(fn (mixed $id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    private function escapeLike(string $term): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $term);
    }
}
