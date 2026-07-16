<?php

namespace App\Services\Comments;

use App\Models\Comment;
use App\Models\Document;
use App\Models\Thread;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

trait RecordsCommentEvents
{
    abstract protected function auditLogger(): AuditLogger;

    /**
     * @param  array<string, mixed>  $meta
     */
    protected function recordEvent(
        string $name,
        Document $document,
        User $actor,
        Model $subject,
        ?string $ip,
        array $meta = [],
    ): void {
        Log::info($name, [
            'document_id' => $document->id,
            ...$this->subjectLogContext($subject),
            ...$meta,
            'user_id' => $actor->id,
        ]);

        $this->auditLogger()->record($document->workspace, $actor, $name, $subject, $meta, ip: $ip);
    }

    /**
     * @return array<string, mixed>
     */
    private function subjectLogContext(Model $subject): array
    {
        if ($subject instanceof Comment) {
            return [
                'thread_id' => $subject->thread_id,
                'comment_id' => $subject->id,
            ];
        }

        if ($subject instanceof Thread) {
            return ['thread_id' => $subject->id];
        }

        return [
            'subject_type' => $subject->getMorphClass(),
            'subject_id' => $subject->getKey(),
        ];
    }
}
