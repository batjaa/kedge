<?php

namespace App\Http\Resources\V1;

use App\Models\Document;
use App\Models\ShareParticipant;
use App\Models\Thread;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class ThreadCapabilities
{
    private function __construct(
        private readonly ?int $viewerId,
        private readonly bool $viewerOwnsDocument,
        private readonly bool $viewerIsWorkspaceMember,
        private readonly bool $viewerHasReviewerIdentity,
        private readonly bool $viewerCanViewThreads,
    ) {}

    public static function for(Request $request, Thread $thread): self
    {
        $user = $request->user();
        if ($user === null) {
            return new self(null, false, false, false, false);
        }

        $document = self::documentFor($thread);
        if (! $document instanceof Document) {
            return new self((int) $user->id, false, false, false, false);
        }

        $key = self::class.':'.$document->id.':'.$user->id;
        $capabilities = $request->attributes->get($key);
        if ($capabilities instanceof self) {
            return $capabilities;
        }

        $viewerId = (int) $user->id;
        $viewerOwnsDocument = $document->created_by !== null && (int) $document->created_by === $viewerId;
        $viewerIsWorkspaceMember = $viewerOwnsDocument
            ? false
            : self::viewerIsWorkspaceMember($viewerId, $document);
        $viewerHasReviewerIdentity = ! $viewerOwnsDocument && self::viewerHasReviewerIdentity($viewerId);
        $capabilities = new self(
            $viewerId,
            $viewerOwnsDocument,
            $viewerIsWorkspaceMember,
            $viewerHasReviewerIdentity,
            $viewerIsWorkspaceMember || ($viewerHasReviewerIdentity
                ? self::viewerIsDocumentReviewer($viewerId, $document)
                : false),
        );
        $request->attributes->set($key, $capabilities);

        return $capabilities;
    }

    public function canTriage(Thread $thread): bool
    {
        if ($this->viewerId === null) {
            return false;
        }

        if ($this->viewerOwnsDocument) {
            return true;
        }

        if (! $this->isViewer($thread->created_by)) {
            return false;
        }

        return ! $this->viewerHasReviewerIdentity || $this->viewerCanViewThreads;
    }

    public function canReanchor(Thread $thread): bool
    {
        if ($this->viewerId === null) {
            return false;
        }

        if ($this->viewerOwnsDocument || $this->viewerIsWorkspaceMember) {
            return true;
        }

        if (! $this->viewerCanViewThreads) {
            return false;
        }

        if ($this->isViewer($thread->created_by)) {
            return true;
        }

        if ($thread->relationLoaded('comments')) {
            return $thread->comments->contains(fn ($comment) => ! $comment->trashed() && $this->isViewer($comment->author_id));
        }

        return $thread->comments()
            ->where('author_id', $this->viewerId)
            ->whereNull('deleted_at')
            ->exists();
    }

    private function isViewer(mixed $userId): bool
    {
        return $userId !== null && (int) $userId === $this->viewerId;
    }

    private static function documentFor(Thread $thread): ?Document
    {
        if (! $thread->relationLoaded('document')) {
            $thread->load('document');
        }

        return $thread->document;
    }

    private static function viewerIsWorkspaceMember(int $viewerId, Document $document): bool
    {
        return DB::table('workspace_members')
            ->where('workspace_id', $document->workspace_id)
            ->where('user_id', $viewerId)
            ->exists();
    }

    private static function viewerIsDocumentReviewer(int $viewerId, Document $document): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $viewerId)
            ->verifiedForActiveDocumentShare($document)
            ->exists();
    }

    private static function viewerHasReviewerIdentity(int $viewerId): bool
    {
        return ShareParticipant::query()
            ->where('user_id', $viewerId)
            ->exists();
    }
}
