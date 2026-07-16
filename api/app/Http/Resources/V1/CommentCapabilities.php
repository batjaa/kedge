<?php

namespace App\Http\Resources\V1;

use App\Enums\CommentType;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use Illuminate\Http\Request;

final class CommentCapabilities
{
    private function __construct(
        private readonly ?int $viewerId,
        private readonly ?int $documentAuthorId,
    ) {}

    public static function for(Request $request, Comment $comment): self
    {
        $user = $request->user();
        if ($user === null) {
            return new self(null, null);
        }

        $document = self::documentFor($comment);
        if (! $document instanceof Document) {
            return new self((int) $user->id, null);
        }

        $key = self::class.':'.$document->id.':'.$user->id;
        $capabilities = $request->attributes->get($key);
        if ($capabilities instanceof self) {
            return $capabilities;
        }

        $capabilities = new self((int) $user->id, $document->created_by === null ? null : (int) $document->created_by);
        $request->attributes->set($key, $capabilities);

        return $capabilities;
    }

    public function canEdit(Comment $comment): bool
    {
        return $this->isViewer($comment->author_id) || $this->viewerOwnsDocument();
    }

    public function canDelete(Comment $comment): bool
    {
        return $this->isViewer($comment->author_id) || $this->viewerOwnsDocument();
    }

    public function canFork(Comment $comment): bool
    {
        $thread = self::threadFor($comment);

        return $this->viewerOwnsDocument() || ($thread instanceof Thread && $this->isViewer($thread->created_by));
    }

    public function canResolveSuggestion(Comment $comment): bool
    {
        return $comment->type === CommentType::Suggestion
            && ! $comment->trashed()
            && $this->viewerOwnsDocument();
    }

    private function isViewer(mixed $userId): bool
    {
        return $this->viewerId !== null && $userId !== null && (int) $userId === $this->viewerId;
    }

    private function viewerOwnsDocument(): bool
    {
        return $this->viewerId !== null
            && $this->documentAuthorId !== null
            && $this->viewerId === $this->documentAuthorId;
    }

    private static function documentFor(Comment $comment): ?Document
    {
        $thread = self::threadFor($comment);
        if (! $thread instanceof Thread) {
            return null;
        }

        if (! $thread->relationLoaded('document')) {
            $thread->load('document');
        }

        return $thread->document;
    }

    private static function threadFor(Comment $comment): ?Thread
    {
        if ($comment->relationLoaded('thread')) {
            $thread = $comment->getRelation('thread');

            return $thread instanceof Thread ? $thread : null;
        }

        $thread = $comment->thread()->with('document')->first();
        if ($thread instanceof Thread) {
            $comment->setRelation('thread', $thread);
        }

        return $thread;
    }
}
