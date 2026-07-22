<?php

namespace App\Services\TrackedRepos;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The denormalized last-scan report (SPEC §16, M3.6, decision 3A) — the record's
 * `last_scan_report` JSON and the panel's poll payload. It captures
 * **discovery-time** outcomes only: for each matched path, whether the scan
 * queued an import, left an already-tracked path unchanged (#94 owns re-sync /
 * missing), or failed that path at discovery time (e.g. a doc-creation constraint
 * violation) — plus per-outcome counts and the scan's duration. It is built up as
 * the diff runs and serialized once, so it is written atomically at completion and
 * never blocks on the dispatched import jobs (per-file blob failures land on the
 * document rows, 4A, not here).
 *
 * A repo-level failure (bad ref, revoked PAT, rate limit, truncation, over-cap)
 * short-circuits before the diff, so its report carries the `error` block and no
 * per-file outcomes — {@see repoFailure}.
 */
final class ScanReport
{
    public const OUTCOME_IMPORT_QUEUED = 'import_queued';

    public const OUTCOME_UNCHANGED = 'unchanged';

    public const OUTCOME_FAILED = 'failed';

    /** @var list<array{path: string, outcome: string, document_id: int|null, reason: string|null}> */
    private array $files = [];

    /** @var array{import_queued: int, unchanged: int, failed: int} */
    private array $counts = [
        self::OUTCOME_IMPORT_QUEUED => 0,
        self::OUTCOME_UNCHANGED => 0,
        self::OUTCOME_FAILED => 0,
    ];

    public function __construct(
        private readonly ?string $ref,
        private readonly bool $staleTakeover,
        private readonly CarbonImmutable $startedAt,
    ) {}

    /** A new matched path whose document was created and its import dispatched. */
    public function importQueued(string $path, int $documentId): void
    {
        $this->add($path, self::OUTCOME_IMPORT_QUEUED, $documentId, null);
    }

    /** An already-tracked path (the (tracked_repo_id, tracked_path) diff key). */
    public function unchanged(string $path, int $documentId): void
    {
        $this->add($path, self::OUTCOME_UNCHANGED, $documentId, null);
    }

    /** A path that could not be turned into a document at discovery time. */
    public function failed(string $path, string $reason): void
    {
        $this->add($path, self::OUTCOME_FAILED, null, $reason);
    }

    /**
     * @return array{import_queued: int, unchanged: int, failed: int}
     */
    public function counts(): array
    {
        return $this->counts;
    }

    public function matched(): int
    {
        return count($this->files);
    }

    /**
     * The completed report — discovery succeeded, the diff ran, per-file outcomes
     * are recorded. `ok` even when some files failed (per-file failures never fail
     * the scan, story 13).
     *
     * @return array<string, mixed>
     */
    public function complete(CarbonInterface $finishedAt): array
    {
        return $this->build('ok', null, $finishedAt);
    }

    /**
     * A repo-level failure report (discovery never reached the diff): the `error`
     * block the panel switches on, no per-file outcomes.
     *
     * @return array<string, mixed>
     */
    public static function repoFailure(
        ?string $ref,
        bool $staleTakeover,
        CarbonImmutable $startedAt,
        string $code,
        string $message,
        CarbonInterface $finishedAt,
    ): array {
        return (new self($ref, $staleTakeover, $startedAt))
            ->build('failed', ['code' => $code, 'message' => $message], $finishedAt);
    }

    private function add(string $path, string $outcome, ?int $documentId, ?string $reason): void
    {
        $this->files[] = [
            'path' => $path,
            'outcome' => $outcome,
            'document_id' => $documentId,
            'reason' => $reason,
        ];
        $this->counts[$outcome]++;
    }

    /**
     * @param  array{code: string, message: string}|null  $error
     * @return array<string, mixed>
     */
    private function build(string $status, ?array $error, CarbonInterface $finishedAt): array
    {
        return [
            'status' => $status,
            'ref' => $this->ref,
            'matched' => count($this->files),
            'counts' => $this->counts,
            'files' => $this->files,
            'error' => $error,
            'stale_takeover' => $this->staleTakeover,
            'started_at' => $this->startedAt->toIso8601String(),
            'finished_at' => $finishedAt->toIso8601String(),
            'duration_ms' => max(0, (int) round(
                $finishedAt->getPreciseTimestamp(3) - $this->startedAt->getPreciseTimestamp(3),
            )),
        ];
    }
}
