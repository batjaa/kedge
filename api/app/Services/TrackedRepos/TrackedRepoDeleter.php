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
 * The FK's `nullOnDelete` would clear `tracked_repo_id` on its own, but the diff
 * key is the pair `(tracked_repo_id, tracked_path)`, so this nulls **both** in one
 * bulk update before deleting — a document whose repo is gone carries no dangling
 * repo-relative path either. The composite unique index tolerates the result:
 * every orphaned document becomes `(null, null)`, and SQL treats NULLs as distinct,
 * so many `(null, null)` rows coexist exactly as ordinary hand-imported documents
 * always have.
 */
class TrackedRepoDeleter
{
    public function __construct(
        private readonly AuditLogger $audit,
    ) {}

    public function delete(TrackedRepo $repo, ?User $actor, ?string $ip = null): void
    {
        $orphaned = DB::transaction(function () use ($repo): int {
            // One bulk update, not N per-document writes: clear the whole provenance
            // pair so the pre-delete state is the same as the post-`nullOnDelete`
            // state, minus the dangling tracked_path.
            $count = $repo->documents()->update([
                'tracked_repo_id' => null,
                'tracked_path' => null,
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
