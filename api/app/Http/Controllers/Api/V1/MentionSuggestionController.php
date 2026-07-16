<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\IndexMentionSuggestionRequest;
use App\Http\Resources\V1\MentionSuggestionResource;
use App\Models\Document;
use App\Models\Thread;
use App\Services\Comments\CommentMentionService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MentionSuggestionController extends Controller
{
    public function __construct(
        private readonly CommentMentionService $mentions,
    ) {}

    public function index(IndexMentionSuggestionRequest $request, Document $document): AnonymousResourceCollection
    {
        $this->authorize('viewAny', [Thread::class, $document]);

        return MentionSuggestionResource::collection(
            $this->mentions->suggestions($document, $request->user(), (string) $request->validated('q', '')),
        );
    }
}
