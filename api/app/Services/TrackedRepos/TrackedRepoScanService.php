<?php

namespace App\Services\TrackedRepos;

use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SourceType;
use App\Enums\TrackedScanStatus;
use App\Jobs\ImportDocumentJob;
use App\Jobs\ResyncDocumentJob;
use App\Models\Document;
use App\Models\TrackedRepo;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Import\TitleSynthesizer;
use App\Services\TrackedRepos\Exceptions\PreviewException;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
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
 * The full diff matrix (#94): a matched path not yet held is **imported** (a new
 * document + the per-file {@see ImportDocumentJob}); a held path whose upstream
 * blob sha moved is **re-synced** (the existing {@see ResyncDocumentJob}, so
 * comments survive through the re-anchoring ladder and identical content is a
 * content-hash no-op); a held path whose sha is unchanged is an honest
 * **unchanged**; a held path no longer matched/present upstream is flagged
 * **missing** — the document is untouched, never deleted, never auto-refiled. An
 * entirely unchanged repo yields an all-unchanged report ("already up to date").
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
     * Flip a settled (or stale-running) record to `pending` so the SERVER owns "a
     * scan is queued" the instant the re-scan trigger returns (A5). Without this,
     * on an async queue the panel's first poll (~1.5s) can read the still-terminal
     * record and settle on the PREVIOUS report before the worker even claims —
     * "optimistic running" settling on a stale report. One atomic conditional
     * update: a losing claimant (a genuinely running scan within the stale bound)
     * no-ops, so a double-press collapses to one queued scan; the report and error
     * are left intact for the panel to keep showing until the scan completes. The
     * job's {@see claim} then advances pending → running.
     */
    public function queue(TrackedRepo $repo, ?CarbonImmutable $now = null): bool
    {
        $now ??= CarbonImmutable::now();
        $staleBefore = $now->subMinutes(self::STALE_MINUTES);

        $affected = TrackedRepo::query()
            ->whereKey($repo->getKey())
            ->where(function ($query) use ($staleBefore) {
                $query->where('last_scan_status', '!=', TrackedScanStatus::Running->value)
                    ->orWhere('last_scanned_at', '<', $staleBefore);
            })
            ->update([
                'last_scan_status' => TrackedScanStatus::Pending->value,
                // Stamps when the scan was queued — the stale bound measures pending
                // liveness against this too (the delete guard's finite wait, A4).
                'last_scanned_at' => $now,
                'updated_at' => $now,
            ]);

        return $affected === 1;
    }

    /**
     * Diff the discovered paths against what the repo already holds and write the
     * completed (ok) report atomically. New paths import, changed paths re-sync,
     * unchanged paths no-op, and held paths gone from the tree are flagged missing
     * (untouched). The report is built in full first, then persisted in one update
     * — a reader never sees a half-report, and the scan never blocks on the
     * dispatched jobs.
     */
    private function completeScan(
        TrackedRepo $repo,
        RepoRef $ref,
        Discovery $discovery,
        CarbonImmutable $startedAt,
        bool $staleTakeover,
        ?int $actorId,
    ): void {
        // The scan diff key (1A): repo-relative path → the held document (id, its
        // recorded blob sha, and whether it is re-sync-able yet).
        $existing = $repo->documents()
            ->get(['id', 'tracked_path', 'tracked_blob_sha', 'current_version_id'])
            ->keyBy('tracked_path');

        $report = new ScanReport($discovery->branch, $staleTakeover, $startedAt);

        /** @var list<Document> $imported */
        $imported = [];
        /** @var list<Document> $resynced */
        $resynced = [];

        foreach ($discovery->paths as $path) {
            /** @var Document|null $held */
            $held = $existing->get($path);
            $currentSha = $discovery->blobShas[$path] ?? '';

            if ($held !== null) {
                $this->diffHeldPath($report, $held, $path, $currentSha, $resynced);

                continue;
            }

            try {
                $document = $this->createDocument($repo, $ref, $discovery->branch, $path, $currentSha);
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

        // Held paths the tree no longer carries: flagged, never deleted (story 10).
        $this->flagMissing($report, $existing, $discovery->paths);

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

        // Only now dispatch — the report is already durable, so a job can never race
        // the report write, and the scan never waited on one.
        foreach ($imported as $document) {
            ImportDocumentJob::dispatch($document);
        }
        foreach ($resynced as $document) {
            ResyncDocumentJob::dispatch($document, $actorId);
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
     * Diff a held path: unchanged when its recorded blob sha still matches the
     * tree; otherwise the blob moved (or its baseline is unknown), so dispatch the
     * existing re-sync and advance the recorded sha. A held path with no current
     * version yet (its first import is still settling) is left unchanged — its blob
     * URL floats with the branch, so that in-flight import already fetches the
     * current content; re-syncing a version-less document would only fail.
     *
     * @param  list<Document>  $resynced  Accumulator dispatched after the atomic report write.
     */
    private function diffHeldPath(
        ScanReport $report,
        Document $held,
        string $path,
        string $currentSha,
        array &$resynced,
    ): void {
        if ($this->blobUnchanged($held->tracked_blob_sha, $currentSha)) {
            $report->unchanged($path, (int) $held->id);

            return;
        }

        if ($held->current_version_id === null) {
            $report->unchanged($path, (int) $held->id);

            return;
        }

        // Advance the recorded sha now (discovery time): the re-sync detected the
        // change, and the document's own retry affordance owns any re-sync failure —
        // re-scan detects new changes, it does not babysit a specific re-sync.
        $held->forceFill(['tracked_blob_sha' => $currentSha])->save();
        $report->resyncQueued($path, (int) $held->id);
        $resynced[] = $held;
    }

    /**
     * Flag every held path the tree no longer carries as missing — the document is
     * untouched (never deleted, never auto-refiled). Sorted for a deterministic
     * report.
     *
     * @param  Collection<string, Document>  $existing
     * @param  list<string>  $discoveredPaths
     */
    private function flagMissing(ScanReport $report, Collection $existing, array $discoveredPaths): void
    {
        $matched = array_flip($discoveredPaths);

        $missing = $existing
            ->reject(fn (Document $doc, string $path): bool => isset($matched[$path]))
            ->sortKeys();

        foreach ($missing as $path => $doc) {
            $report->missing($path, (int) $doc->id);
        }
    }

    /**
     * Whether a held document's recorded blob sha still matches the tree's. Only a
     * concrete match counts as unchanged — an absent recorded sha (a pre-#94 doc)
     * or an unknowable tree sha reads as changed, so the safe outcome is a re-sync
     * that content-hash no-ops and heals the baseline, never a silent skip.
     */
    private function blobUnchanged(?string $recorded, string $current): bool
    {
        return $recorded !== null && $recorded !== '' && $current !== '' && $recorded === $current;
    }

    /**
     * Create a document for a newly-matched path (SPEC §16): filed into the repo's
     * project, stamped with its tracked-repo provenance, the diff key, and the blob
     * sha this scan observed (the re-scan change baseline, #94), sourced at the
     * file's blob URL on the resolved branch so the existing import job reads it
     * exactly like a hand-imported blob URL. Authenticated (PAT) when the repo is,
     * public otherwise — the same posture the listing used.
     */
    private function createDocument(TrackedRepo $repo, RepoRef $ref, string $branch, string $path, string $blobSha): Document
    {
        $blobUrl = $this->blobUrl($ref, $branch, $path);

        $sourceType = $repo->integration_id !== null
            ? SourceType::GithubPat
            : SourceType::GithubPublic;

        return Document::create([
            'workspace_id' => $repo->workspace_id,
            'project_id' => $repo->project_id,
            'tracked_repo_id' => $repo->id,
            'tracked_path' => $path,
            'tracked_blob_sha' => $blobSha === '' ? null : $blobSha,
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
     * The `github.com/{owner}/{repo}/blob/{branch}/{path}` URL a scan-minted
     * document is sourced at. The branch and path are URL-encoded per `/`-split
     * segment (slashes preserved as separators): a git path may legitimately hold
     * a `#`, `?`, or space, and a raw concatenation would truncate the doc's
     * source at {@see parse_url} — the import fetch would then permanently 404 on a
     * short path. The blob connector's {@see AbstractGithubBlobConnector} decodes
     * each segment back, so this round-trips exactly to the contents API URL.
     */
    private function blobUrl(RepoRef $ref, string $branch, string $path): string
    {
        // owner/repo stay raw: the blob connector reads them without decoding and
        // encodes them itself, so encoding here would double-encode.
        return 'https://github.com/'.$ref->owner.'/'.$ref->repo.'/blob/'
            .$this->encodeSegments($branch).'/'.$this->encodeSegments($path);
    }

    /** rawurlencode each `/`-delimited segment, keeping the slashes as separators. */
    private function encodeSegments(string $value): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $value)));
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
