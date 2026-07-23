<?php

namespace App\Services\Projects;

use App\Models\Project;
use Illuminate\Support\Str;

/**
 * Mints a URL slug unique within a workspace for a project name (SPEC §16). Slug
 * derivation is business logic, so it lives in a Service (the AGENTS.md Services
 * rule), not inline in the controller. The `(workspace_id, slug)` unique index is
 * the hard guarantee; this keeps the common case a clean handle and only suffixes
 * on a genuine collision, and never yields an empty slug.
 */
class ProjectSlugger
{
    public function uniqueSlug(int $workspaceId, string $name): string
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
