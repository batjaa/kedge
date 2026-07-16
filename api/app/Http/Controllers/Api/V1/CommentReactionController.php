<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\CommentResource;
use App\Models\Comment;
use App\Services\Comments\CommentReactionService;
use Illuminate\Http\Request;

class CommentReactionController extends Controller
{
    public function __construct(
        private readonly CommentReactionService $reactions,
    ) {}

    public function store(Request $request, Comment $comment): CommentResource
    {
        $this->authorize('react', $comment);

        return CommentResource::make(
            $this->reactions->toggle($comment, $request->user()),
        );
    }
}
