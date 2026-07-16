<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\ThreadStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreThreadRequest;
use App\Http\Requests\UpdateThreadStatusRequest;
use App\Http\Resources\V1\ThreadResource;
use App\Models\Document;
use App\Models\Thread;
use App\Services\Comments\CommentThreadService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ThreadController extends Controller
{
    public function __construct(
        private readonly CommentThreadService $threads,
    ) {}

    public function index(Request $request, Document $document): AnonymousResourceCollection
    {
        $this->authorize('viewAny', [Thread::class, $document]);

        return ThreadResource::collection(
            $this->threads->listForDocument($document, (int) $request->integer('per_page', 20), $request->user()),
        );
    }

    public function store(StoreThreadRequest $request, Document $document)
    {
        $this->authorize('create', [Thread::class, $document]);

        [$thread, $status] = $this->threads->create(
            $document,
            $request->user(),
            $request->validated(),
            $request->ip(),
        );

        return ThreadResource::make($thread)
            ->response()
            ->setStatusCode($status);
    }

    public function update(UpdateThreadStatusRequest $request, Thread $thread)
    {
        $this->authorize('triage', $thread);

        $thread = $this->threads->updateStatus(
            $thread,
            $request->user(),
            ThreadStatus::from((string) $request->validated('status')),
            $request->ip(),
        );

        return ThreadResource::make($thread);
    }
}
