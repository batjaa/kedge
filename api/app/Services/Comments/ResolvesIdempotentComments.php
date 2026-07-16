<?php

namespace App\Services\Comments;

use App\Models\Comment;
use Illuminate\Database\QueryException;

trait ResolvesIdempotentComments
{
    protected function idempotentCommentByAuthorId(int $authorId, mixed $key, string $scope, int $scopeId): ?Comment
    {
        if (! is_string($key) || $key === '') {
            return null;
        }

        return Comment::query()
            ->withTrashed()
            ->where('author_id', $authorId)
            ->where('idempotency_key', $key)
            ->where('idempotency_scope', $scope)
            ->where('idempotency_scope_id', $scopeId)
            ->with(['author', 'thread'])
            ->first();
    }

    protected function idempotentCommentAfterDuplicateByAuthorId(
        QueryException $exception,
        int $authorId,
        string $key,
        string $scope,
        int $scopeId,
    ): Comment {
        if (! $this->isDuplicateIdempotencyException($exception)) {
            throw $exception;
        }

        $existing = $this->idempotentCommentByAuthorId($authorId, $key, $scope, $scopeId);
        if ($existing === null) {
            throw $exception;
        }

        return $existing;
    }

    private function isDuplicateIdempotencyException(QueryException $exception): bool
    {
        $code = (string) $exception->getCode();
        $message = $exception->getMessage();

        return in_array($code, ['23000', '23505'], true)
            || str_contains($message, 'comments_author_idempotency_scope_unique')
            || (str_contains($message, 'comments') && str_contains($message, 'idempotency'));
    }
}
