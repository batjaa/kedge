<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\PreviewTrackedRepoRequest;
use App\Models\TrackedRepo;
use App\Policies\TrackedRepoPolicy;
use App\Services\Documents\DocumentProjectAssignment;
use App\Services\TrackedRepos\Exceptions\PreviewException;
use App\Services\TrackedRepos\TrackedRepoPreviewService;
use Illuminate\Http\JsonResponse;

/**
 * Tracked repos (SPEC §16, M3.6). This milestone is READ-ONLY: `preview` lists
 * exactly which files a scan would import — matches, per-path overlap warnings
 * (10A), and loud over-cap (story 18) / truncation (4A) failures — with no
 * persistence and no import (the scan is #93). Every action authorizes through
 * {@see TrackedRepoPolicy}: an id in a URL is never an access path, and a
 * workspace-less reviewer is refused 403 (never a 500).
 */
class TrackedRepoController extends Controller
{
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
}
