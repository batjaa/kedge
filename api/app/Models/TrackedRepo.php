<?php

namespace App\Models;

use App\Enums\TrackedScanStatus;
use App\Policies\TrackedRepoPolicy;
use Database\Factories\TrackedRepoFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A tracked repo (SPEC §16, M3.6): a workspace-owned record — repo URL + ref +
 * path pattern — Kedge can scan on demand to import matching files into a
 * project. Reachable only within its workspace ({@see TrackedRepoPolicy} + the
 * controller's workspace scoping); an id in a URL is never an access path.
 *
 * READ-ONLY milestone: this ticket only previews (no scan, no persistence beyond
 * the columns). `last_scan_status` starts `pending` (never scanned); the scan
 * pipeline (#93) writes the outcome and the per-file report.
 */
#[Fillable([
    'workspace_id', 'project_id', 'integration_id', 'repo_url', 'ref', 'path_pattern',
    'last_scan_status', 'scan_error', 'last_scanned_at', 'last_scan_report', 'created_by',
])]
class TrackedRepo extends Model
{
    /** @use HasFactory<TrackedRepoFactory> */
    use HasFactory;

    /**
     * Mirror the migration default so a freshly built record already reports its
     * never-scanned state before a DB round-trip.
     *
     * @var array<string, string>
     */
    protected $attributes = [
        'last_scan_status' => 'pending',
    ];

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /**
     * The project a scan files matching files into, or null (SPEC §16). A tracked
     * repo is provenance and refresh machinery, never the document's container.
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** The workspace PAT this repo authenticates with, or null for a public repo (#23). */
    public function integration(): BelongsTo
    {
        return $this->belongsTo(Integration::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The documents a scan imported from this repo (SPEC §16). Deleting the
     * tracked repo nulls the FK — the documents remain, provenance cleared.
     *
     * @return HasMany<Document, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(Document::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_scan_status' => TrackedScanStatus::class,
            'last_scan_report' => 'array',
            'last_scanned_at' => 'datetime',
        ];
    }
}
