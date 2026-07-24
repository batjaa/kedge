<?php

namespace App\Services\Activity;

use App\Models\Approval;
use App\Models\AuditLog;
use App\Models\Comment;
use App\Models\Document;
use App\Models\Workspace;
use App\Support\Activity\ActivityTarget;
use Illuminate\Support\Collection;

/**
 * Resolves each audit row's morph subject to a navigable target (decision 2A) —
 * the ONLY place the feed touches live data. The sentence always comes from the
 * frozen meta snapshot; this exists solely to build the link, and a subject (or
 * its document) that has since been deleted yields no target, so the row keeps
 * its sentence and drops the link.
 *
 * Batched by construction: a whole page resolves in a fixed three queries
 * (comments→document, approvals→document, then a single existence sweep) rather
 * than one per row, so the feed never N+1s as the trail grows.
 */
class ActivityTargetResolver
{
    /**
     * @param  Collection<int, AuditLog>  $logs
     * @return array<int, ActivityTarget|null> keyed by audit-log id
     */
    public function resolve(Collection $logs): array
    {
        $documentClass = (new Document)->getMorphClass();
        $commentClass = (new Comment)->getMorphClass();
        $approvalClass = (new Approval)->getMorphClass();
        $workspaceClass = (new Workspace)->getMorphClass();

        $subjectIds = fn (string $class): array => $logs
            ->where('subject_type', $class)
            ->pluck('subject_id')
            ->filter()
            ->map(static fn ($id): int => (int) $id)
            ->unique()
            ->values()
            ->all();

        $documentSubjectIds = $subjectIds($documentClass);
        $commentIds = $subjectIds($commentClass);
        $approvalIds = $subjectIds($approvalClass);

        // Comment → owning document. The SoftDeletes global scope excludes a
        // deleted comment, so its row resolves to no target (2A). One query.
        $commentToDocument = $commentIds === []
            ? []
            : Comment::query()
                ->whereIn('comments.id', $commentIds)
                ->join('threads', 'threads.id', '=', 'comments.thread_id')
                ->pluck('threads.document_id', 'comments.id')
                ->all();

        // Approval → owning document. One query.
        $approvalToDocument = $approvalIds === []
            ? []
            : Approval::query()
                ->whereIn('id', $approvalIds)
                ->pluck('document_id', 'id')
                ->all();

        // A single existence sweep over every candidate document id: a document
        // deleted since the event drops the link uniformly, whatever the subject.
        $candidateDocumentIds = collect($documentSubjectIds)
            ->merge(array_values($commentToDocument))
            ->merge(array_values($approvalToDocument))
            ->filter()
            ->map(static fn ($id): int => (int) $id)
            ->unique()
            ->values()
            ->all();

        $existingDocuments = $candidateDocumentIds === []
            ? []
            : array_flip(
                Document::query()->whereIn('id', $candidateDocumentIds)->pluck('id')->all()
            );

        $documentTarget = static fn (?int $documentId): ?ActivityTarget => $documentId !== null
            && isset($existingDocuments[$documentId])
                ? ActivityTarget::document($documentId)
                : null;

        $targets = [];
        foreach ($logs as $log) {
            $subjectId = $log->subject_id === null ? null : (int) $log->subject_id;

            $targets[$log->id] = match ($log->subject_type) {
                $documentClass => $documentTarget($subjectId),
                $commentClass => $documentTarget(
                    isset($commentToDocument[$subjectId]) ? (int) $commentToDocument[$subjectId] : null,
                ),
                $approvalClass => $documentTarget(
                    isset($approvalToDocument[$subjectId]) ? (int) $approvalToDocument[$subjectId] : null,
                ),
                // The workspace is always the caller's own (the feed is scoped to
                // it), so a rename always links to its settings page.
                $workspaceClass => ActivityTarget::workspace(),
                default => null,
            };
        }

        return $targets;
    }
}
