<?php

namespace App\Services\TrackedRepos;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\TrackedScanStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Import\TitleSynthesizer;
use App\Services\TrackedRepos\Exceptions\PreviewException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The scan pipeline (SPEC §16, M3.6, decisions 3A/4A/5A) — the heart of a
 * self-filling project. It claims the repo's single scan slot atomically, runs the
 * shared {@see RepoDiscoveryService} (ref → tree → pattern ∩ allowlist → cap /
 * truncation), diffs the matched paths against what the repo already holds, imports
 * the new ones through the existing per-file {@see ImportDocumentJob}, and writes a
 * discovery-outcome report atomically at completion. Everything a scan touches is a
 * path the same-workspace author could already import by hand — comment persistence
 * never depends on any of it (this only feeds the M1/M3 import path).
 *
 * This ticket (#93) diffs first-scan semantics only: a matched path not yet held is
 * imported; an already-held path is `unchanged`. Re-sync of a changed blob and the
 * missing flag are #94 — deliberately not built here.
 */
class TrackedRepoScanService
{
    /**
     * A `running` claim older than this is reclaimable (5A) — a crashed worker can
     * never wedge the record. The trigger endpoint's DELETE-while-running wait is
     * bounded by the same number (7A).
     */
    public const STALE_MINUTES = 15;

    public function __construct(
        private readonly RepoDiscoveryService $discovery,
        private readonly TitleSynthesizer $titles,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Run one scan of $repo. Claims the slot first: a losing claimant (a
     * double-click, a race, a not-yet-stale in-flight scan) returns without a
     * write, so the trigger endpoint stays idempotent (5A). $actorId is who
     * triggered it (the creator for the first scan; the clicker for a re-scan) —
     * recorded in the audit trail (story 20).
     */
    public function scan(TrackedRepo $repo, ?int $actorId = null): void
    {
        $now = CarbonImmutable::now();
        $claim = $this->claim($repo, $now);

        if (! $claim->claimed) {
            Log::info('scan.skipped', [
                'tracked_repo_id' => $repo->id,
                'reason' => 'already_running',
            ]);

            return;
        }

        // Reload post-claim: the running status, and the integration + workspace the
        // rest of the scan reads (the token, the audit workspace).
        $repo->refresh()->loadMissing(['integration', 'workspace']);

        $ref = RepoRef::fromUrl($repo->repo_url);

        try {
            if ($ref === null) {
                throw PreviewException::unsupportedRepo();
            }

            $discovery = $this->discovery->discover(
                $ref,
                $repo->ref,
                $repo->integration?->token(),
                $repo->path_pattern,
                (int) config('kedge.tracked_repos.file_cap', 200),
            );
        } catch (PreviewException $e) {
            $this->completeRepoFailure($repo, $now, $claim->staleTakeover, $e, $actorId);

            return;
        }

        $this->completeScan($repo, $ref, $discovery, $now, $claim->staleTakeover, $actorId);
    }

    /**
     * Claim the scan slot with a single atomic conditional update (5A): affected
     * rows is the verdict, so exactly one concurrent claimant wins — no cache, no
     * lock. Claimable when the repo is NOT already running, OR its `running` claim
     * is older than the stale bound (a crashed worker). The pre-read only decides
     * whether to note the takeover; correctness rides entirely on affected rows.
     */
    public function claim(TrackedRepo $repo, CarbonImmutable $now): ScanClaim
    {
        $staleBefore = $now->subMinutes(self::STALE_MINUTES);

        $current = TrackedRepo::query()->whereKey($repo->getKey())->first();
        $staleTakeover = $current !== null
            && $current->last_scan_status === TrackedScanStatus::Running
            && $current->last_scanned_at !== null
            && $current->last_scanned_at->lt($staleBefore);

        $affected = TrackedRepo::query()
            ->whereKey($repo->getKey())
            ->where(function ($query) use ($staleBefore) {
                $query->where('last_scan_status', '!=', TrackedScanStatus::Running->value)
                    ->orWhere('last_scanned_at', '<', $staleBefore);
            })
            ->update([
                'last_scan_status' => TrackedScanStatus::Running->value,
                // Marks the run's start — this is what the stale check measures against
                // while the scan is in flight; completion overwrites it with the finish.
                'last_scanned_at' => $now,
                'updated_at' => $now,
            ]);

        return new ScanClaim(claimed: $affected === 1, staleTakeover: $staleTakeover);
    }

    /**
     * Diff the discovered paths against what the repo already holds, import the new
     * ones, and write the completed (ok) report atomically. The report is built in
     * full first, then persisted in one update — a reader never sees a half-report,
     * and the scan never blocks on the dispatched import jobs.
     */
    private function completeScan(
        TrackedRepo $repo,
        RepoRef $ref,
        Discovery $discovery,
        CarbonImmutable $startedAt,
        bool $staleTakeover,
        ?int $actorId,
    ): void {
        // The scan diff key (1A): repo-relative path → existing document id.
        $existing = $repo->documents()->pluck('id', 'tracked_path');

        $report = new ScanReport($discovery->branch, $staleTakeover, $startedAt);

        /** @var list<Document> $imported */
        $imported = [];

        foreach ($discovery->paths as $path) {
            $existingId = $existing[$path] ?? null;
            if ($existingId !== null) {
                // #94 owns changed/missing; a held path is unchanged here.
                $report->unchanged($path, (int) $existingId);

                continue;
            }

            try {
                $document = $this->createDocument($repo, $ref, $discovery->branch, $path);
            } catch (Throwable $e) {
                // A discovery-time per-path failure (e.g. the (tracked_repo_id,
                // tracked_path) unique index rejecting a duplicate, or a concurrent
                // scan that already minted the row): fail this path, never the scan.
                Log::warning('scan.file_failed', [
                    'tracked_repo_id' => $repo->id,
                    'path' => $path,
                    'error' => $e->getMessage(),
                ]);
                $report->failed($path, 'This file could not be imported.');

                continue;
            }

            $report->importQueued($path, $document->id);
            $imported[] = $document;
        }

        $finishedAt = CarbonImmutable::now();
        $payload = $report->complete($finishedAt);

        // Atomic completion: status, resolved ref, timestamp, and the whole report
        // in one write. `ref` is persisted concrete (the resolved default branch when
        // it was omitted) so the record — and the M6 webhook — key on a real branch.
        $repo->forceFill([
            'last_scan_status' => TrackedScanStatus::Ok,
            'ref' => $discovery->branch,
            'scan_error' => null,
            'last_scanned_at' => $finishedAt,
            'last_scan_report' => $payload,
        ])->save();

        // Only now dispatch — the report is already durable, so an import job can
        // never race the report write, and the scan never waited on a job.
        foreach ($imported as $document) {
            ImportDocumentJob::dispatch($document);
        }

        Log::info('scan.completed', [
            'tracked_repo_id' => $repo->id,
            'ref' => $discovery->branch,
            'matched' => $report->matched(),
            ...$report->counts(),
            'duration_ms' => $payload['duration_ms'],
            'stale_takeover' => $staleTakeover,
        ]);

        $this->recordAudit($repo, $actorId, 'ok', [
            'ref' => $discovery->branch,
            'matched' => $report->matched(),
            'counts' => $report->counts(),
            'stale_takeover' => $staleTakeover,
        ]);
    }

    /**
     * Write a repo-level failure (bad ref, revoked PAT, rate limit, truncation,
     * over-cap) atomically: the failed status, the author-facing message on
     * `scan_error`, and the error-only report. No documents were touched.
     */
    private function completeRepoFailure(
        TrackedRepo $repo,
        CarbonImmutable $startedAt,
        bool $staleTakeover,
        PreviewException $e,
        ?int $actorId,
    ): void {
        $finishedAt = CarbonImmutable::now();
        $payload = ScanReport::repoFailure(
            $repo->ref,
            $staleTakeover,
            $startedAt,
            $e->error,
            $e->getMessage(),
            $finishedAt,
        );

        $repo->forceFill([
            'last_scan_status' => TrackedScanStatus::Failed,
            'scan_error' => $e->getMessage(),
            'last_scanned_at' => $finishedAt,
            'last_scan_report' => $payload,
        ])->save();

        Log::warning('scan.failed', [
            'tracked_repo_id' => $repo->id,
            'error' => $e->error,
            'duration_ms' => $payload['duration_ms'],
            'stale_takeover' => $staleTakeover,
        ]);

        $this->recordAudit($repo, $actorId, 'failed', [
            'error' => $e->error,
            'stale_takeover' => $staleTakeover,
        ]);
    }

    /**
     * Create a document for a newly-matched path (SPEC §16): filed into the repo's
     * project, stamped with its tracked-repo provenance and the diff key, sourced at
     * the file's blob URL on the resolved branch so the existing import job reads it
     * exactly like a hand-imported blob URL. Authenticated (PAT) when the repo is,
     * public otherwise — the same posture the listing used.
     */
    private function createDocument(TrackedRepo $repo, RepoRef $ref, string $branch, string $path): Document
    {
        $blobUrl = 'https://github.com/'.$ref->owner.'/'.$ref->repo.'/blob/'.$branch.'/'.$path;

        $sourceType = $repo->integration_id !== null
            ? SourceType::GithubPat
            : SourceType::GithubPublic;

        return Document::create([
            'workspace_id' => $repo->workspace_id,
            'project_id' => $repo->project_id,
            'tracked_repo_id' => $repo->id,
            'tracked_path' => $path,
            'integration_id' => $repo->integration_id,
            'source_type' => $sourceType,
            'source_url' => $blobUrl,
            'title' => $this->titles->filenameFrom($blobUrl),
            'format' => DocumentFormat::Md,
            'status' => DocumentStatus::Importing,
            'created_by' => $repo->created_by,
        ]);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    private function recordAudit(TrackedRepo $repo, ?int $actorId, string $status, array $meta): void
    {
        $this->audit->record(
            $repo->workspace,
            $actorId !== null ? User::find($actorId) : null,
            'tracked_repo.scanned',
            $repo,
            ['status' => $status, ...$meta],
        );
    }
}
