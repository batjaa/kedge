<?php

namespace App\Services\Approvals;

use App\Enums\AuditEvent;
use App\Enums\DocumentStatus;
use App\Models\Approval;
use App\Models\Document;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Support\Collection;
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
        /** @var array{Approval, int, Collection<int, Approval>} $result */
        $result = DB::transaction(function () use ($document, $actor): array {
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
                return [$this->loadForResource($existing, $lockedDocument), 200, collect()];
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
            }

            $approval = Approval::create([
                'workspace_id' => $lockedDocument->workspace_id,
                'document_id' => $lockedDocument->id,
                'document_version_id' => $lockedDocument->current_version_id,
                'user_id' => $actor->id,
            ]);

            return [$this->loadForResource($approval, $lockedDocument, $actor), 201, $supersededApprovals];
        });

        [$approval, $status, $supersededApprovals] = $result;

        // Every trail entry is a post-commit side effect that must never roll back
        // or fail the grant (AC #4) — hence recordSafely, outside the transaction.
        // Both the grant and the supersessions it caused are written here, so no
        // audit write is inside the transaction that persisted the approval.
        if ($status === 201) {
            foreach ($supersededApprovals as $supersededApproval) {
                $this->audit->recordSafely(
                    $approval->document->workspace,
                    $actor,
                    AuditEvent::ApprovalRevoked,
                    $supersededApproval,
                    [
                        'document_id' => $approval->document_id,
                        'document_version_id' => $supersededApproval->document_version_id,
                        'reason' => 'superseded',
                        'superseded_by_document_version_id' => $approval->document_version_id,
                    ],
                    $ip,
                );
            }

            // Display snapshot (2A): the doc title and approver name at grant time.
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
