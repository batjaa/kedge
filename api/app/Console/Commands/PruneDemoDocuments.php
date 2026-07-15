<?php

namespace App\Console\Commands;

use App\Models\Document;
use App\Services\SystemWorkspace;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Reaps expired demo documents (SPEC §10.3, #25). A demo doc lives for 48h in the
 * reserved system workspace; if no one claims it before `expires_at`, this command
 * deletes it — and its versions and share links ride out on the database's cascade
 * (`document_versions` and `shares` are both `cascadeOnDelete`).
 *
 * Runs on the scheduler (routes/console.php). Scoped to the system workspace and
 * to a non-null, past `expires_at`, so it can never touch a claimed doc (whose TTL
 * was cleared and whose workspace changed) or an ordinary document. On an instance
 * that never ran demo mode the system workspace does not exist, and the command is
 * a clean no-op.
 */
class PruneDemoDocuments extends Command
{
    protected $signature = 'kedge:prune-demo-docs';

    protected $description = 'Delete expired, unclaimed demo documents (SPEC 10.3)';

    public function handle(SystemWorkspace $system): int
    {
        $workspace = $system->find();

        if ($workspace === null) {
            $this->info('No system workspace — nothing to prune.');

            return self::SUCCESS;
        }

        $expiredIds = Document::query()
            ->where('workspace_id', $workspace->id)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->pluck('id');

        if ($expiredIds->isEmpty()) {
            $this->info('No expired demo documents to prune.');

            return self::SUCCESS;
        }

        // One DELETE; the DB cascades versions + shares. Bounded work — the query
        // is index-covered on (workspace_id, expires_at).
        Document::whereIn('id', $expiredIds)->delete();

        Log::info('demo.pruned', ['count' => $expiredIds->count()]);
        $this->info("Pruned {$expiredIds->count()} expired demo document(s).");

        return self::SUCCESS;
    }
}
