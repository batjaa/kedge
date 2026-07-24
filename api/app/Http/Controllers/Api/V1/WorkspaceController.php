<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateWorkspaceRequest;
use App\Http\Resources\V1\WorkspaceResource;
use App\Models\Workspace;
use App\Policies\WorkspacePolicy;
use App\Services\AuditLogger;

/**
 * Workspace settings — General (SPEC §16, M3.7 decision 11A). A workspace owner
 * renames the workspace and edits its slug; the change shows across the app's
 * chrome.
 *
 * Scoped to the caller's own personal workspace, exactly like the integrations
 * surface (M1 tenancy is invisible): there is no workspace id in the URL, so a
 * foreign workspace is structurally unreachable, not merely policy-checked.
 * {@see WorkspacePolicy} is the second guard — owner-only — and a workspace-less
 * reviewer is refused 403, never a 500.
 */
class WorkspaceController extends Controller
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    /**
     * PATCH /api/v1/workspace — rename / re-slug the caller's own workspace.
     * Partial: only the fields sent are applied. A slug clash is rejected inline
     * by {@see UpdateWorkspaceRequest} with a friendly 422.
     */
    public function update(UpdateWorkspaceRequest $request): WorkspaceResource
    {
        $workspace = $request->user()->personalWorkspace();

        // A reviewer with no owned workspace has nothing to authorize against — a
        // fresh (id-less) Workspace denies through the owner check rather than
        // dereferencing null. Owners resolve their real workspace and pass.
        $this->authorize('update', $workspace ?? new Workspace);

        /** @var Workspace $workspace */
        $before = ['name' => $workspace->name, 'slug' => $workspace->slug];

        $workspace->fill($request->validated())->save();

        // Only a real change earns a trail entry — a no-op save never noises up
        // M3.8's feed. The audit write is a side effect of the committed rename:
        // if it throws it is logged, never surfaced, so the rename always stands.
        if ($workspace->wasChanged(['name', 'slug'])) {
            $this->audit->recordSafely(
                $workspace,
                $request->user(),
                'workspace.renamed',
                $workspace,
                [
                    'from' => $before,
                    'to' => ['name' => $workspace->name, 'slug' => $workspace->slug],
                ],
                $request->ip(),
            );
        }

        return WorkspaceResource::make($workspace);
    }
}
