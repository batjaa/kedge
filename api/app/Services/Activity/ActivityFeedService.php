<?php

namespace App\Services\Activity;

use App\Models\AuditLog;
use App\Models\Workspace;
use App\Support\Activity\ActivityFeedEvent;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * Reads a workspace's recent activity (M3.8 #111). Scopes the append-only audit
 * trail to the caller's workspace, narrows it to the feed's type allowlist,
 * orders newest-first, paginates at the database (never in PHP), then resolves
 * each page's target links in one batch (no N+1) and projects every row through
 * the 3A allowlist. Loaded once on page load — no polling; M5 owns liveness.
 */
class ActivityFeedService
{
    public function __construct(
        private readonly ActivityTargetResolver $targets,
    ) {}

    /**
     * @return LengthAwarePaginator<ActivityFeedEvent>
     */
    public function feed(Workspace $workspace, int $perPage): LengthAwarePaginator
    {
        $paginator = AuditLog::query()
            ->where('workspace_id', $workspace->id)
            ->whereIn('action', ActivityFeedEvent::feedActions())
            // created_at then id: rows written in the same second (a re-sync's
            // digest + gone-stale) still order deterministically, and pagination
            // never skips or repeats one (the composite index, 10A, serves both).
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($perPage);

        // Resolve targets while the page is still AuditLog models, then project.
        $targets = $this->targets->resolve($paginator->getCollection(), $workspace);

        return $paginator->through(
            fn (AuditLog $log): ActivityFeedEvent => ActivityFeedEvent::fromAuditLog(
                $log,
                $targets[$log->id] ?? null,
            ),
        );
    }
}
