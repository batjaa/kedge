<?php

namespace App\Services\TrackedRepos;

use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Un-tracking a repo (SPEC §16, M3.6, decision 7A): the record goes, every
 * document it imported stays — provenance cleared, review history intact.
 * Deleting a tracked repo is reversible organization, never data loss (story 16).
 *
 * The FK's `nullOnDelete` clears `tracked_repo_id`; this additionally clears
 * `tracked_blob_sha` (a stale re-scan baseline for a repo that no longer exists)
 * but deliberately **keeps `tracked_path`**. Keeping the path is what lets the
 * workspace-wide overlap warning (10A) still see an orphaned document: re-tracking
 * a repo whose files these once were would otherwise silently mint duplicates. The
 * composite unique index `(tracked_repo_id, tracked_path)` tolerates the orphan —
 * `tracked_repo_id` is null, and SQL treats a NULL member as distinct, so any
 * number of `(null, path)` rows coexist (even the same path from two deleted repos).
 */
class TrackedRepoDeleter
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    public function delete(TrackedRepo $repo, ?User $actor, ?string $ip = null): void
    {
        $orphaned = DB::transaction(function () use ($repo): int {
            // One bulk update, not N per-document writes: drop the repo link and the
            // stale re-scan baseline, but KEEP tracked_path so the orphan stays
            // visible to the overlap warning (10A) — re-tracking must not silently
            // duplicate what these documents already hold.
            $count = $repo->documents()->update([
                'tracked_repo_id' => null,
                'tracked_blob_sha' => null,
            ]);

            $repo->delete();

            return $count;
        });

        $this->audit->record(
            $repo->workspace,
            $actor,
            'tracked_repo.deleted',
            $repo,
            ['repo_url' => $repo->repo_url, 'documents_orphaned' => $orphaned],
            $ip,
        );
    }
}
