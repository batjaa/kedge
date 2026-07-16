<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreThreadCommentRequest;
use App\Http\Resources\V1\CommentResource;
use App\Models\Thread;
use App\Services\Comments\CommentThreadService;

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
}
