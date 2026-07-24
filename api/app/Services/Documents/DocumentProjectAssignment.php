<?php

namespace App\Services\Documents;

use App\Enums\AuditEvent;
use App\Models\Document;
use App\Models\Project;
use App\Models\User;
use App\Models\Workspace;
use App\Services\AuditLogger;

/**
 * Filing a document under a project, or clearing it back to Unfiled (SPEC §16,
 * M3.6). The one place the workspace-scoping rule lives: the target project MUST
 * belong to the document's own workspace, and a foreign id reads as not-found
 * (8A, the no-existence-leak convention) — never a 403 that would confirm the
 * project exists elsewhere. Shared by import-with-a-project (store) and
 * assignment (PATCH), so both honour the same rule through one code path.
 */
class DocumentProjectAssignment
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Resolve a project id within a workspace, or abort 404. Null passes through
     * as Unfiled. Callers that create a document use this up front so a foreign
     * project id never mints a row.
     */
    public function resolve(Workspace $workspace, ?int $projectId): ?Project
    {
        if ($projectId === null) {
            return null;
        }

        $project = $workspace->projects()->whereKey($projectId)->first();

        // A foreign (or absent) project id is indistinguishable from "no such
        // project" — the no-existence-leak convention (8A).
        abort_if($project === null, 404, 'No such project in this workspace.');

        return $project;
    }

    /**
     * Move a document to a project (or clear it), then audit the move. Returns
     * the saved document. A null target dissociates — moving to Unfiled is
     * clearing, not a special row.
     */
    public function assign(Document $document, ?int $projectId, ?User $actor, ?string $ip): Document
    {
        $project = $this->resolve($document->workspace, $projectId);

        if ($project === null) {
            $document->project()->dissociate();
        } else {
            $document->project()->associate($project);
        }

        $document->save();

        $this->audit->record(
            $document->workspace,
            $actor,
            AuditEvent::DocumentProjectAssigned,
            $document,
            ['project_id' => $project?->id],
            $ip,
        );

        return $document;
    }
}
