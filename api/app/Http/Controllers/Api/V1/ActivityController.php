<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\ActivityEventResource;
use App\Models\Workspace;
use App\Policies\WorkspacePolicy;
use App\Services\Activity\ActivityFeedService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * GET /api/v1/workspace/activity — the dashboard's Recent activity feed (SPEC
 * §16, M3.8; decisions 3A/10A/A1). {@see WorkspacePolicy} authorizes
 * (personal-workspace holders only — a magic-link reviewer gets 403, never a
 * 500); the {@see ActivityFeedService} then scopes every row to that same
 * workspace, so an id is never an access path and the system workspace's demo
 * audit rows fall outside the scope structurally. A free, paginated read — like
 * the summary — so no dedicated limiter; the panel loads page 1 once with no
 * polling (M5 owns liveness).
 */
class ActivityController extends Controller
{
    /**
     * The default page size — the recent slice the dashboard panel shows.
     * Capped low; the feed is a catch-up glance, not an archive browser.
     */
    private const PER_PAGE = 15;

    public function __invoke(Request $request, ActivityFeedService $feed): AnonymousResourceCollection
    {
        $this->authorize('viewActivity', Workspace::class);

        return ActivityEventResource::collection(
            $feed->feed($request->user()->personalWorkspace(), self::PER_PAGE),
        );
    }
}
