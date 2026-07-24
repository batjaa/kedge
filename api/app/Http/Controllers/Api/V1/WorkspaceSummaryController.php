<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\WorkspaceSummaryResource;
use App\Models\Workspace;
use App\Policies\WorkspacePolicy;
use App\Services\Workspace\WorkspaceSummaryService;
use Illuminate\Http\Request;

/**
 * GET /api/v1/workspace/summary — the authenticated dashboard's at-a-glance
 * state (SPEC §16, M3.7): document totals + per-lifecycle counts, open/orphaned
 * threads, stale approvals, imports in flight. {@see WorkspacePolicy} authorizes
 * (personal-workspace holders only — a magic-link reviewer gets 403, never a
 * 500); the {@see WorkspaceSummaryService} then scopes every count to that same
 * workspace, so an id is never an access path and the system workspace's demo
 * docs fall outside the scope structurally. A free read — no dedicated limiter.
 */
class WorkspaceSummaryController extends Controller
{
    public function __invoke(Request $request, WorkspaceSummaryService $summaries): WorkspaceSummaryResource
    {
        $this->authorize('viewSummary', Workspace::class);

        return WorkspaceSummaryResource::make(
            $summaries->summarize($request->user()->personalWorkspace()),
        );
    }
}
