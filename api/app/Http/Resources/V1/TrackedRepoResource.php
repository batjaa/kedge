<?php

namespace App\Http\Resources\V1;

use App\Models\TrackedRepo;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A tracked repo as the web reads it (SPEC §16, M3.6, #93). The project page's
 * panel renders each record's state and last-scan report; the show endpoint is the
 * scan poll target (the panel polls it until `last_scan_status` leaves `running`).
 * `last_scan_report` is the denormalized discovery-outcome report (3A) — counts,
 * per-file outcomes, repo-level error, and the stale-takeover note — which the
 * panel both summarizes and mines for the `import_queued` document ids it
 * materializes as live importing rows.
 *
 * Hand-kept in sync with web/lib/tracked-repos-client.ts.
 *
 * @mixin TrackedRepo
 */
class TrackedRepoResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'repo_url' => $this->repo_url,
            'ref' => $this->ref,
            'path_pattern' => $this->path_pattern,
            'last_scan_status' => $this->last_scan_status->value,
            'scan_error' => $this->scan_error,
            'last_scanned_at' => $this->last_scanned_at,
            'last_scan_report' => $this->last_scan_report,
            'created_at' => $this->created_at,
        ];
    }
}
