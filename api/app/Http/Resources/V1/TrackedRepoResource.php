<?php

namespace App\Http\Resources\V1;

use App\Enums\TrackedScanStatus;
use App\Models\TrackedRepo;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A tracked repo as the web reads it (SPEC §16, M3.6, #93). The project page's
 * panel renders each record's state and last-scan report; the show endpoint is the
 * scan poll target (the panel polls it until `last_scan_status` leaves `running`).
 * `last_scan_report` is the denormalized discovery-outcome report (3A) — counts,
 * per-file outcomes, repo-level error, and the stale-takeover note.
 *
 * The per-file `files` array can be large (up to the file cap), so it is SLIMMED
 * away except where it is actually needed (C11): the index collection carries
 * summary counts only, and the show poll target carries them only when the scan has
 * SETTLED (the moment the panel materializes the `import_queued` document ids as
 * live rows). While a scan is running/pending the poll only cares about the status,
 * so its repeated reads stay lean. Call {@see detailed} to opt a single-record read
 * into the full per-file entries; the `files` shape is preserved (an empty array,
 * never a missing key) so the web contract holds.
 *
 * Hand-kept in sync with web/lib/tracked-repos-client.ts.
 *
 * @mixin TrackedRepo
 */
class TrackedRepoResource extends JsonResource
{
    /** Whether this single-record read may carry the full per-file report (show). */
    private bool $detailed = false;

    /** Opt this read into the full per-file report when the scan has settled (show). */
    public function detailed(bool $value = true): static
    {
        $this->detailed = $value;

        return $this;
    }

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
            'last_scan_report' => $this->report(),
            'created_at' => $this->created_at,
        ];
    }

    /**
     * The report to serialize: full per-file entries only for a detailed read of a
     * SETTLED record; otherwise the summary (counts, matched, error, timings) with
     * `files` emptied. Null passes straight through (a never-scanned record).
     *
     * @return array<string, mixed>|null
     */
    private function report(): ?array
    {
        $report = $this->last_scan_report;
        if ($report === null) {
            return null;
        }

        $inFlight = in_array(
            $this->last_scan_status,
            [TrackedScanStatus::Running, TrackedScanStatus::Pending],
            true,
        );

        if ($this->detailed && ! $inFlight) {
            return $report;
        }

        // Preserve the shape — an empty array, never a missing key — so the web's
        // `files: []` contract and its count-based predicates keep working.
        $report['files'] = [];

        return $report;
    }
}
