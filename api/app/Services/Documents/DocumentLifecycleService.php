<?php

namespace App\Services\Documents;

use App\Enums\LifecycleStatus;
use App\Models\Document;
use App\Models\User;
use App\Services\AuditLogger;

class DocumentLifecycleService
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    public function update(Document $document, User $actor, LifecycleStatus $status, ?string $ip): Document
    {
        $document->loadMissing('workspace');
        $from = $document->lifecycle_status;

        if ($from === $status) {
            return $this->loadForResource($document);
        }

        $document->forceFill(['lifecycle_status' => $status])->save();

        $this->audit->record(
            $document->workspace,
            $actor,
            'lifecycle.changed',
            $document,
            [
                'from' => $from?->value,
                'to' => $status->value,
            ],
            $ip,
        );

        return $this->loadForResource($document->refresh());
    }

    private function loadForResource(Document $document): Document
    {
        return $document->loadCurrentVersionAndApprovals();
    }
}
