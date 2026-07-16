<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\ForkCommentRequest;
use App\Http\Requests\StoreThreadCommentRequest;
use App\Http\Requests\UpdateCommentRequest;
use App\Http\Resources\V1\CommentResource;
use App\Http\Resources\V1\ThreadResource;
use App\Models\Comment;
use App\Models\Thread;
use App\Services\Comments\CommentThreadService;
use Illuminate\Http\Request;

class ThreadCommentController extends Controller
{
    public function __construct(
        private readonly CommentThreadService $threads,
    ) {}

    public function store(StoreThreadCommentRequest $request, Thread $thread)
    {
        $this->authorize('reply', $thread);

        [$comment, $status] = $this->threads->reply(
            $thread,
            $request->user(),
            $request->validated(),
            $request->ip(),
        );

        return CommentResource::make($comment)
            ->response()
            ->setStatusCode($status);
    }

    public function fork(ForkCommentRequest $request, Comment $comment)
    {
        $this->authorize('forkComment', [Thread::class, $comment]);

        [$thread, $status] = $this->threads->fork(
            $comment,
            $request->user(),
            $request->validated(),
            $request->ip(),
        );

        return ThreadResource::make($thread)
            ->response()
            ->setStatusCode($status);
    }

    public function update(UpdateCommentRequest $request, Comment $comment)
    {
        $this->authorize('updateComment', [Thread::class, $comment]);

        $comment = $this->threads->updateComment(
            $comment,
            $request->user(),
            (string) $request->validated('body'),
            $request->ip(),
        );

        return CommentResource::make($comment);
    }

    public function destroy(Request $request, Comment $comment)
    {
        $this->authorize('deleteComment', [Thread::class, $comment]);

        $this->threads->deleteComment($comment, $request->user(), $request->ip());

        return response()->noContent();
    }
}
