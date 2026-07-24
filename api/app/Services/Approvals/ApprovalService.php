<?php

namespace App\Services\Approvals;

use App\Enums\AuditEvent;
use App\Enums\DocumentStatus;
use App\Models\Approval;
use App\Models\Document;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\DB;

class ApprovalService
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Approve the current document version. Idempotency is scoped to the current
     * version: an active approval on that exact version is returned; a stale
     * approval on an older version is superseded only when the reviewer
     * explicitly approves the new current version.
     *
     * @return array{Approval, int}
     */
    public function approveCurrent(Document $document, User $actor, ?string $ip): array
    {
        [$approval, $status] = DB::transaction(function () use ($document, $actor, $ip): array {
            $lockedDocument = Document::query()
                ->with('workspace')
                ->whereKey($document->id)
                ->lockForUpdate()
                ->firstOrFail();

            abort_unless(
                $lockedDocument->status === DocumentStatus::Ready && $lockedDocument->current_version_id !== null,
                409,
                'Only a ready document can be approved.',
            );

            $existing = Approval::query()
                ->where('document_id', $lockedDocument->id)
                ->where('document_version_id', $lockedDocument->current_version_id)
                ->where('user_id', $actor->id)
                ->whereNull('revoked_at')
                ->first();

            if ($existing) {
                return [$this->loadForResource($existing, $lockedDocument), 200];
            }

            $supersededApprovals = Approval::query()
                ->where('document_id', $lockedDocument->id)
                ->where('user_id', $actor->id)
                ->whereNull('revoked_at')
                ->where('document_version_id', '!=', $lockedDocument->current_version_id)
                ->orderBy('id')
                ->get();

            $revokedAt = now();
            foreach ($supersededApprovals as $supersededApproval) {
                $supersededApproval->forceFill(['revoked_at' => $revokedAt])->save();

                // Superseding the reviewer's own older approvals is part of the
                // re-approval itself, so its trail entry stays atomic with the
                // write (throwing record()).
                $this->audit->record(
                    $lockedDocument->workspace,
                    $actor,
                    AuditEvent::ApprovalRevoked,
                    $supersededApproval,
                    [
                        'document_id' => $lockedDocument->id,
                        'document_version_id' => $supersededApproval->document_version_id,
                        'reason' => 'superseded',
                        'superseded_by_document_version_id' => $lockedDocument->current_version_id,
                    ],
                    $ip,
                );
            }

            $approval = Approval::create([
                'workspace_id' => $lockedDocument->workspace_id,
                'document_id' => $lockedDocument->id,
                'document_version_id' => $lockedDocument->current_version_id,
                'user_id' => $actor->id,
            ]);

            return [$this->loadForResource($approval, $lockedDocument, $actor), 201];
        });

        // The grant has committed. Its trail entry is a post-commit side effect
        // that must never roll back or fail the approval (AC #4) — hence
        // recordSafely, outside the transaction. Display snapshot (2A): the doc
        // title and approver name as they read at approval time.
        if ($status === 201) {
            $this->audit->recordSafely(
                $approval->document->workspace,
                $actor,
                AuditEvent::ApprovalGiven,
                $approval,
                [
                    'document_id' => $approval->document_id,
                    'document_version_id' => $approval->document_version_id,
                    'document_title' => $approval->document->title,
                    'actor_name' => $actor->name,
                ],
                $ip,
            );
        }

        return [$approval, $status];
    }

    public function revoke(Approval $approval, User $actor, ?string $ip): Approval
    {
        $approval->loadMissing('document.workspace');

        if ($approval->revoked_at !== null) {
            return $this->loadForResource($approval, $approval->document, $actor);
        }

        $approval->forceFill(['revoked_at' => now()])->save();

        $this->audit->record(
            $approval->document->workspace,
            $actor,
            AuditEvent::ApprovalRevoked,
            $approval,
            [
                'document_id' => $approval->document_id,
                'document_version_id' => $approval->document_version_id,
            ],
            $ip,
        );

        return $this->loadForResource($approval->refresh(), $approval->document, $actor);
    }

    private function loadForResource(Approval $approval, Document $document, ?User $actor = null): Approval
    {
        $approval->loadMissing('user');
        if ($actor !== null && (int) $approval->user_id === (int) $actor->id) {
            $approval->setRelation('user', $actor);
        }
        $approval->setRelation('document', $document);

        return $approval;
    }
}
