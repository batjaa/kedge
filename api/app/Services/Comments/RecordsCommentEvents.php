<?php

namespace App\Services\Comments;

use App\Enums\AuditEvent;
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
        AuditEvent $event,
        Document $document,
        ?User $actor,
        Model $subject,
        ?string $ip,
        array $meta = [],
        string $level = 'info',
    ): void {
        $context = [
            'document_id' => $document->id,
            ...$this->subjectLogContext($subject),
            ...$meta,
            'user_id' => $actor?->id,
        ];

        $level === 'warning'
            ? Log::warning($event->value, $context)
            : Log::info($event->value, $context);

        // recordSafely, never record(): a review action (a posted comment, a
        // triaged suggestion) has already committed by the time we get here, and
        // the hard rule is that comment persistence must never depend on the audit
        // write. A dead trail sink is logged and swallowed, never surfaced.
        //
        // The meta carries a display snapshot (2A): the doc title, the actor's
        // name, and the section the thread sits on — captured as they read at
        // event time — so M3.8's feed renders the row's sentence even after the
        // subject (comment, thread, or its author) is deleted.
        $this->auditLogger()->recordSafely(
            $document->workspace,
            $actor,
            $event,
            $subject,
            [...$this->displaySnapshot($document, $actor, $subject), ...$meta],
            ip: $ip,
        );
    }

    /**
     * Actor-visible strings frozen at write time so a feed row renders from the
     * row alone (2A). Null fields (a system actor, a document-level thread with no
     * section) are dropped rather than stored.
     *
     * @return array<string, mixed>
     */
    private function displaySnapshot(Document $document, ?User $actor, Model $subject): array
    {
        return array_filter([
            'document_title' => $document->title,
            'actor_name' => $actor?->name,
            'section' => $this->sectionLabel($subject),
        ], static fn ($value): bool => $value !== null);
    }

    /**
     * The nearest heading of the thread's most recent anchor — the section a
     * reader would recognise the thread by. Null for a document-level thread or a
     * non-thread subject (e.g. a share).
     */
    private function sectionLabel(Model $subject): ?string
    {
        $thread = match (true) {
            $subject instanceof Thread => $subject,
            $subject instanceof Comment => $subject->loadMissing('thread')->thread,
            default => null,
        };

        if ($thread === null) {
            return null;
        }

        $thread->loadMissing('anchors');
        $headingPath = array_values(array_filter(
            (array) ($thread->anchors->sortByDesc('id')->first()?->heading_path ?? []),
            'is_string',
        ));

        return $headingPath === [] ? null : (string) end($headingPath);
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
