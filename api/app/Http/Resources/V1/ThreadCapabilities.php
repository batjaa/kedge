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
        private readonly bool $viewerHasReviewerIdentity,
        private readonly bool $viewerCanViewThreads,
    ) {}

    public static function for(Request $request, Thread $thread): self
    {
        $user = $request->user();
        if ($user === null) {
            return new self(null, false, false, false);
        }

        $document = self::documentFor($thread);
        if (! $document instanceof Document) {
            return new self((int) $user->id, false, false, false);
        }

        $key = self::class.':'.$document->id.':'.$user->id;
        $capabilities = $request->attributes->get($key);
        if ($capabilities instanceof self) {
            return $capabilities;
        }

        $viewerId = (int) $user->id;
        $viewerOwnsDocument = $document->created_by !== null && (int) $document->created_by === $viewerId;
        $viewerHasReviewerIdentity = ! $viewerOwnsDocument && self::viewerHasReviewerIdentity($viewerId);
        $capabilities = new self(
            $viewerId,
            $viewerOwnsDocument,
            $viewerHasReviewerIdentity,
            $viewerHasReviewerIdentity
                ? self::viewerCanViewThreads($viewerId, $document)
                : false,
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

    private static function viewerCanViewThreads(int $viewerId, Document $document): bool
    {
        return self::viewerIsWorkspaceMember($viewerId, $document)
            || self::viewerIsDocumentReviewer($viewerId, $document);
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
