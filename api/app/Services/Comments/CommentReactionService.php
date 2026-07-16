<?php

namespace App\Services\Comments;

use App\Models\Comment;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

class CommentReactionService
{
    public const THUMBS_UP = "\u{1F44D}";

    public function toggle(Comment $comment, User $actor): Comment
    {
        if ($comment->trashed()) {
            throw new HttpResponseException(response()->json([
                'message' => 'Deleted comments cannot receive reactions.',
                'code' => 'comment_deleted',
                'errors' => ['comment' => ['comment_deleted']],
            ], 422));
        }

        $reacted = DB::transaction(function () use ($comment, $actor): bool {
            $deleted = DB::table('comment_reactions')
                ->where('comment_id', $comment->id)
                ->where('user_id', $actor->id)
                ->where('emoji', self::THUMBS_UP)
                ->delete();

            if ($deleted > 0) {
                return false;
            }

            try {
                DB::table('comment_reactions')->insert([
                    'comment_id' => $comment->id,
                    'user_id' => $actor->id,
                    'emoji' => self::THUMBS_UP,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } catch (QueryException) {
                return true;
            }

            return true;
        });

        $comment->setAttribute('reaction_count', $this->countFor($comment));
        $comment->setAttribute('viewer_has_reacted', $reacted);

        return $comment->load(['author', 'thread.document']);
    }

    private function countFor(Comment $comment): int
    {
        return DB::table('comment_reactions')
            ->where('comment_id', $comment->id)
            ->where('emoji', self::THUMBS_UP)
            ->count();
    }
}
