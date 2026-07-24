<?php

namespace App\Http\Resources\V1;

use App\Services\Workspace\WorkspaceSummaryService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The dashboard summary as the web reads it (SPEC §16, M3.7) — the stats strip
 * and the lifecycle filter-chip counts. The shape is owned end-to-end by
 * {@see WorkspaceSummaryService::summarize()}; this
 * resource is the stable HTTP contract wrapper (no `data` envelope — the house
 * shape for a single resource) and is hand-kept in sync with
 * web/lib/document-types.ts (WorkspaceSummary).
 *
 *   documents: { total, importing, needs_attention, lifecycle: { draft, in_review, approved, superseded } }
 *   threads:   { open, orphaned }
 *   approvals: { stale }
 */
class WorkspaceSummaryResource extends JsonResource
{
    /** @var string|null */
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return $this->resource;
    }
}
