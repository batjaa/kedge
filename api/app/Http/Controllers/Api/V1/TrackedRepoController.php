<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PreviewTrackedRepoRequest;
use App\Http\Requests\StoreTrackedRepoRequest;
use App\Http\Resources\V1\TrackedRepoResource;
use App\Jobs\ScanTrackedRepoJob;
use App\Models\TrackedRepo;
use App\Policies\TrackedRepoPolicy;
use App\Services\AuditLogger;
use App\Services\Documents\DocumentProjectAssignment;
use App\Services\TrackedRepos\Exceptions\PreviewException;
use App\Services\TrackedRepos\TrackedRepoDeleter;
use App\Services\TrackedRepos\TrackedRepoPreviewService;
use App\Services\TrackedRepos\TrackedRepoScanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Tracked repos (SPEC §16, M3.6). `preview` lists what a scan would import with no
 * side effects (#92); `store` persists the record and dispatches its first scan
 * (#93); `show` is the scan poll target (record + running state + last report);
 * `scan` re-triggers, idempotently. Every action authorizes through
 * {@see TrackedRepoPolicy}: an id in a URL is never an access path, and a
 * workspace-less reviewer is refused 403 (never a 500). Scans are queued — every
 * write returns 202 so a slow GitHub listing never blocks the UI.
 */
class TrackedRepoController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/tracked-repos — the workspace's tracked repos, newest first, with
     * an optional `?project=` filter (a numeric id scopes to that project). The
     * query is workspace-scoped, so an id is never an access path and a foreign
     * project id simply matches nothing. The project page reads this to render each
     * record's state + last report.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', TrackedRepo::class);

        $query = $request->user()->personalWorkspace()->trackedRepos();

        $project = $request->query('project');
        if ($project !== null && $project !== '') {
            $query->where('project_id', (int) $project);
        }

        return TrackedRepoResource::collection(
            $query->latest('id')->get(),
        );
    }

    /**
     * POST /api/v1/tracked-repos/preview — {repo_url, ref?, path_pattern, project_id?}.
     * Read-only. Auth reuses single-file import's posture: the workspace PAT when
     * connected (private repos + higher quota), otherwise public.
     */
    public function preview(
        PreviewTrackedRepoRequest $request,
        TrackedRepoPreviewService $service,
        DocumentProjectAssignment $projects,
    ): JsonResponse {
        $this->authorize('create', TrackedRepo::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        // An optional project target is validated up front — a foreign id 404s
        // (8A, the no-existence-leak convention), exactly as import does.
        $projects->resolve(
            $workspace,
            $request->filled('project_id') ? (int) $request->validated('project_id') : null,
        );

        try {
            $preview = $service->preview(
                $workspace,
                $workspace->githubPatIntegration(),
                (string) $request->validated('repo_url'),
                $request->filled('ref') ? trim((string) $request->validated('ref')) : null,
                (string) $request->validated('path_pattern'),
            );
        } catch (PreviewException $e) {
            return response()->json($e->toArray(), 422);
        }

        return response()->json($preview->toArray());
    }

    /**
     * POST /api/v1/tracked-repos — persist the record and dispatch its first scan
     * (SPEC §16, #93). Validated like preview (branch-only ref is the scan's job,
     * 2A; a foreign project id 404s, 8A). The workspace PAT is bound now so the scan
     * authenticates exactly as single-file import does. 202 with the pending record
     * — the panel polls {@see show} until the scan settles.
     */
    public function store(
        StoreTrackedRepoRequest $request,
        DocumentProjectAssignment $projects,
    ): JsonResponse {
        $this->authorize('create', TrackedRepo::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $project = $projects->resolve(
            $workspace,
            $request->filled('project_id') ? (int) $request->validated('project_id') : null,
        );

        $trackedRepo = $workspace->trackedRepos()->create([
            'project_id' => $project?->id,
            'integration_id' => $workspace->githubPatIntegration()?->id,
            'repo_url' => (string) $request->validated('repo_url'),
            'ref' => $request->filled('ref') ? trim((string) $request->validated('ref')) : null,
            'path_pattern' => (string) $request->validated('path_pattern'),
            'created_by' => $user->id,
        ]);

        $this->audit->record(
            $workspace,
            $user,
            'tracked_repo.created',
            $trackedRepo,
            ['repo_url' => $trackedRepo->repo_url, 'path_pattern' => $trackedRepo->path_pattern],
            $request->ip(),
        );

        ScanTrackedRepoJob::dispatch($trackedRepo, $user->id);

        return TrackedRepoResource::make($trackedRepo)
            ->response()
            ->setStatusCode(202);
    }

    /**
     * GET /api/v1/tracked-repos/{trackedRepo} — the record, its running state, and
     * its last-scan report (the poll target; the panel settles when the status
     * leaves `running`). A foreign id is denied (403), never confirmed to exist.
     */
    public function show(TrackedRepo $trackedRepo): TrackedRepoResource
    {
        $this->authorize('view', $trackedRepo);

        return TrackedRepoResource::make($trackedRepo);
    }

    /**
     * POST /api/v1/tracked-repos/{trackedRepo}/scan — re-trigger a scan. Idempotent
     * (202): the trigger atomically flips the record to `pending` so the SERVER owns
     * "a scan is queued" before the job runs (A5) — the panel then can't settle on
     * the stale report while an async worker catches up. The service's atomic claim
     * collapses a double-click or a race onto one scan (5A), so pressing twice is
     * safe. The pending record (report intact) rides back in the 202.
     */
    public function scan(Request $request, TrackedRepo $trackedRepo, TrackedRepoScanService $scanner): JsonResponse
    {
        $this->authorize('scan', $trackedRepo);

        $scanner->queue($trackedRepo);

        ScanTrackedRepoJob::dispatch($trackedRepo, $request->user()->id);

        return TrackedRepoResource::make($trackedRepo->refresh())
            ->response()
            ->setStatusCode(202);
    }

    /**
     * DELETE /api/v1/tracked-repos/{trackedRepo} — un-track the repo (7A). Every
     * document it imported stays; only its provenance is cleared. Blocked with a
     * 409 while a scan is running (the stale bound keeps that wait finite), so a
     * delete can't race a scan mid-import. Policy-gated and audit-logged; a foreign
     * id is denied 403, never confirmed to exist.
     */
    public function destroy(Request $request, TrackedRepo $trackedRepo, TrackedRepoDeleter $deleter): Response
    {
        $this->authorize('delete', $trackedRepo);

        if ($trackedRepo->hasRunningScan()) {
            abort(409, 'A scan is running — wait for it to finish, then delete.');
        }

        $deleter->delete($trackedRepo, $request->user(), $request->ip());

        return response()->noContent();
    }
}
