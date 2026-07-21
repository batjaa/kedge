<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Requests\UpdateProjectRequest;
use App\Http\Resources\V1\ProjectResource;
use App\Models\Project;
use App\Policies\ProjectPolicy;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Str;

/**
 * Projects — free containers for grouping a workspace's documents (SPEC §16,
 * M3.6). Every action authorizes through {@see ProjectPolicy}: an id in a URL is
 * never an access path. List and create are scoped to the caller's own personal
 * workspace (M1 tenancy is invisible), so cross-workspace reach is structurally
 * impossible, not merely policy-checked; update resolves a row by id and so is
 * policy-guarded. No delete this milestone (a project with docs poses questions
 * v1 doesn't answer).
 */
class ProjectController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * GET /api/v1/projects — the workspace's projects, name-ordered (the home's
     * grouping and the assignment selectors read this set). `documents_count`
     * rides a withCount so the UI can label each project without an N+1.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Project::class);

        $projects = $request->user()->personalWorkspace()->projects()
            ->withCount('documents')
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        return ProjectResource::collection($projects);
    }

    /**
     * POST /api/v1/projects — create a project in the caller's own workspace.
     * The name rules (required, ≤100, unique per workspace) are enforced by
     * {@see StoreProjectRequest} with a friendly 422 (6A).
     */
    public function store(StoreProjectRequest $request): JsonResponse
    {
        $this->authorize('create', Project::class);

        $user = $request->user();
        $workspace = $user->personalWorkspace();

        $name = (string) $request->validated('name');
        $project = $workspace->projects()->create([
            'name' => $name,
            'slug' => $this->uniqueSlug($workspace->id, $name),
            'description' => $request->validated('description'),
            'created_by' => $user->id,
        ]);

        $this->audit->record(
            $workspace,
            $user,
            'project.created',
            $project,
            ['name' => $project->name],
            $request->ip(),
        );

        return ProjectResource::make($project->loadCount('documents'))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * PATCH /api/v1/projects/{project} — rename or re-describe. Partial: only the
     * fields sent are applied. The slug is a stable handle, so a rename never
     * moves it.
     */
    public function update(UpdateProjectRequest $request, Project $project): ProjectResource
    {
        $this->authorize('update', $project);

        $project->fill($request->validated())->save();

        $this->audit->record(
            $project->workspace,
            $request->user(),
            'project.updated',
            $project,
            ['name' => $project->name],
            $request->ip(),
        );

        return ProjectResource::make($project->loadCount('documents'));
    }

    /**
     * A slug unique within the workspace, derived from the name. The `(workspace,
     * slug)` unique index is the hard guarantee; this keeps the common case a
     * clean handle and only suffixes on a genuine collision.
     */
    private function uniqueSlug(int $workspaceId, string $name): string
    {
        $base = Str::slug($name);

        // A name of only punctuation/emoji slugs to '' — fall back so the handle
        // is never empty.
        if ($base === '') {
            $base = 'project';
        }

        $slug = $base;
        while (Project::where('workspace_id', $workspaceId)->where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(6));
        }

        return $slug;
    }
}
