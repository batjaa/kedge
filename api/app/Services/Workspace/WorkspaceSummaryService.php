<?php

namespace App\Services\Workspace;

use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Models\Approval;
use App\Models\Thread;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Builder;

/**
 * The authenticated dashboard's at-a-glance state (SPEC §16, M3.7): document
 * totals, per-lifecycle counts, open/orphaned threads, stale approvals, and
 * imports in flight for one workspace. Every count reads a *shared* predicate —
 * the lifecycle scopes, {@see Thread::scopeOrphaned()}, {@see Approval::scopeStale()},
 * and {@see Document::scopeNeedsAttention()} — never a re-encoded one (decision
 * 7A), so the strip, the filter chips, and the list can never disagree. The
 * trivial per-document counts ride a single conditional-aggregate pass; the
 * EXISTS-heavy composites (needs-attention, orphans, stale) are one bounded
 * count each.
 */
class WorkspaceSummaryService
{
    /**
     * @return array{
     *     documents: array{
     *         total: int,
     *         importing: int,
     *         needs_attention: int,
     *         lifecycle: array{draft: int, in_review: int, approved: int, superseded: int}
     *     },
     *     threads: array{open: int, orphaned: int},
     *     approvals: array{stale: int}
     * }
     */
    public function summarize(Workspace $workspace): array
    {
        $documents = $this->documentAggregates($workspace);

        return [
            'documents' => [
                'total' => (int) $documents->total,
                'importing' => (int) $documents->importing,
                'needs_attention' => $workspace->documents()->needsAttention()->count(),
                'lifecycle' => [
                    'draft' => (int) $documents->draft,
                    'in_review' => (int) $documents->in_review,
                    'approved' => (int) $documents->approved,
                    'superseded' => (int) $documents->superseded,
                ],
            ],
            'threads' => [
                'open' => $this->workspaceThreads($workspace)->open()->count(),
                'orphaned' => $this->workspaceThreads($workspace)->orphaned()->count(),
            ],
            'approvals' => [
                'stale' => Approval::query()
                    ->where('workspace_id', $workspace->id)
                    ->active()
                    ->stale()
                    ->count(),
            ],
        ];
    }

    /**
     * The trivial per-document counts in one pass: the total, the four editorial
     * lifecycle buckets, and imports in flight. `toBase()` sidesteps model
     * hydration for a pure aggregate row; SUM over zero rows is NULL, cast to 0.
     */
    private function documentAggregates(Workspace $workspace): object
    {
        return $workspace->documents()
            ->toBase()
            ->selectRaw(
                'COUNT(*) as total, '
                .'SUM(CASE WHEN lifecycle_status = ? THEN 1 ELSE 0 END) as draft, '
                .'SUM(CASE WHEN lifecycle_status = ? THEN 1 ELSE 0 END) as in_review, '
                .'SUM(CASE WHEN lifecycle_status = ? THEN 1 ELSE 0 END) as approved, '
                .'SUM(CASE WHEN lifecycle_status = ? THEN 1 ELSE 0 END) as superseded, '
                .'SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as importing',
                [
                    LifecycleStatus::Draft->value,
                    LifecycleStatus::InReview->value,
                    LifecycleStatus::Approved->value,
                    LifecycleStatus::Superseded->value,
                    DocumentStatus::Importing->value,
                ],
            )
            ->first();
    }

    /**
     * Threads whose document lives in this workspace. Threads carry no
     * workspace_id (they belong to a document), so scoping goes through the
     * document — the same structural boundary the documents list uses.
     *
     * @return Builder<Thread>
     */
    private function workspaceThreads(Workspace $workspace): Builder
    {
        return Thread::query()
            ->whereHas('document', fn (Builder $query) => $query->where('workspace_id', $workspace->id));
    }
}
