<?php

namespace App\Models;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\LifecycleStatus;
use App\Enums\SourceType;
use App\Enums\SyncStatus;
use App\Services\SystemWorkspace;
use Database\Factories\DocumentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A document's stable identity within a workspace (SPEC 16). Its rendered
 * content lives on the {@see DocumentVersion} pointed to by
 * `current_version_id`; the import job (SPEC 5.3) drives `status` and, on
 * failure, `last_sync_status` + `sync_error`.
 */
#[Fillable([
    'workspace_id', 'project_id', 'tracked_repo_id', 'tracked_path', 'tracked_blob_sha', 'integration_id',
    'source_type', 'source_url', 'source_meta',
    'title', 'format', 'current_version_id', 'status', 'last_sync_status',
    'sync_error', 'lifecycle_status', 'expires_at', 'created_by',
])]
class Document extends Model
{
    /** @use HasFactory<DocumentFactory> */
    use HasFactory;

    /**
     * @var array<int, int>|null
     */
    private ?array $versionOrdinalMap = null;

    /**
     * In-memory defaults that mirror the migration's column defaults, so a
     * freshly created model (before a DB round-trip) already carries its enum
     * columns — the import response is serialized straight from it.
     *
     * @var array<string, string>
     */
    protected $attributes = [
        'status' => 'importing',
        'last_sync_status' => 'ok',
        'lifecycle_status' => 'draft',
        'format' => 'md',
    ];

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /**
     * The project this document is filed under, or null for Unfiled (SPEC §16,
     * M3.6). Assignment moves freely and back to Unfiled; the project is a
     * grouping container, never the document's owner.
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * The tracked repo a scan imported this document from, or null for a
     * hand-imported doc (SPEC §16, M3.6). Provenance only — it survives project
     * moves and is nulled (never cascaded) when the tracked repo is deleted.
     * `tracked_path` is the repo-relative path within it; the pair is the scan
     * diff key, unique per document.
     */
    public function trackedRepo(): BelongsTo
    {
        return $this->belongsTo(TrackedRepo::class);
    }

    /**
     * A demo document (SPEC §10.3, #25): one owned by the reserved system
     * workspace, awaiting either a claim or the 48h prune. Membership in that
     * workspace is the canonical signal — claiming moves the doc out of it (and
     * clears {@see $expires_at}), so this flips to false the instant it is owned.
     * Drives the claim Policy and the "Claim this doc" surface on the share page.
     */
    public function isDemo(): bool
    {
        return $this->workspace_id === app(SystemWorkspace::class)->id();
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return HasMany<DocumentVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class);
    }

    /** @return HasMany<DocumentVersion, $this> */
    public function versionsWithOrdinals(): HasMany
    {
        return $this->versions()
            ->select('document_versions.*')
            ->selectRaw('ROW_NUMBER() OVER (ORDER BY document_versions.id) as ordinal')
            ->lineageOrdered();
    }

    /**
     * Per-document display ordinals for mainline versions. M3's lineage order is
     * id order; this helper gives resources one cached map instead of asking per
     * version.
     *
     * @return array<int, int>
     */
    public function versionOrdinalMap(): array
    {
        if ($this->versionOrdinalMap !== null) {
            return $this->versionOrdinalMap;
        }

        $this->versionOrdinalMap = $this->versions()
            ->lineageOrdered()
            ->pluck('document_versions.id')
            ->values()
            ->mapWithKeys(fn (int $id, int $index): array => [$id => $index + 1])
            ->all();

        return $this->versionOrdinalMap;
    }

    public function ordinalForVersionId(?int $versionId): ?int
    {
        if ($versionId === null) {
            return null;
        }

        return $this->versionOrdinalMap()[$versionId] ?? null;
    }

    public function versionLabelForVersionId(?int $versionId): string
    {
        $ordinal = $this->ordinalForVersionId($versionId);

        return $ordinal === null ? 'v?' : "v{$ordinal}";
    }

    /**
     * Share links handed out for this document (SPEC 10.2). Cascade-deleted with
     * the document; a share never outlives what it points at.
     *
     * @return HasMany<Share, $this>
     */
    public function shares(): HasMany
    {
        return $this->hasMany(Share::class);
    }

    /** @return HasMany<Thread, $this> */
    public function threads(): HasMany
    {
        return $this->hasMany(Thread::class);
    }

    /** @return HasMany<Approval, $this> */
    public function approvals(): HasMany
    {
        return $this->hasMany(Approval::class);
    }

    /** @return HasMany<Approval, $this> */
    public function activeApprovals(): HasMany
    {
        return $this->approvals()
            ->whereNull('revoked_at')
            ->orderBy('created_at')
            ->orderBy('id');
    }

    public function loadCurrentVersionAndApprovals(): self
    {
        $this->load(['currentVersion', 'activeApprovals.user']);
        $this->activeApprovals->each(fn (Approval $approval) => $approval->setRelation('document', $this));

        return $this;
    }

    /**
     * The version currently rendered. Not a FK (the constraint would be circular
     * with document_versions.document_id) — just a pointer resolved by id.
     */
    public function currentVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class, 'current_version_id');
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source_type' => SourceType::class,
            'source_meta' => 'array',
            'format' => DocumentFormat::class,
            'status' => DocumentStatus::class,
            'last_sync_status' => SyncStatus::class,
            'lifecycle_status' => LifecycleStatus::class,
            'expires_at' => 'datetime',
        ];
    }
}
