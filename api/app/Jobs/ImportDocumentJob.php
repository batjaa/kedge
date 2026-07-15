<?php

namespace App\Jobs;

use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Models\Document;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Import\DocumentImporter;
use App\Services\Import\Exceptions\RateLimitedException;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Runs one document's import off the request path (SPEC 5.3). `ShouldBeUnique`
 * per document collapses a concurrent double-submit (or a manual retry racing an
 * in-flight import) onto a single job.
 *
 * Failure handling follows the §19 registry, and separates two policies:
 *   - A blocked URL is deterministic — it will not become allowed on retry — so
 *     the document is marked failed immediately, with no further attempts.
 *   - A real fetch/normalize error bubbles up; {@see $maxExceptions} caps those at
 *     three (the "retry ×3 backoff → failed"), then {@see failed()} records the
 *     terminal failure and the web offers a retry CTA.
 *   - A source rate-limit (GitHub 403/429) is not a failure: the job releases
 *     itself for the honored Retry-After without spending an exception, so a
 *     throttled import backs off and resumes ("Rate-limited, retrying") instead of
 *     burning its budget. {@see $tries} is the overall ceiling so a permanently
 *     throttled source still terminates.
 */
class ImportDocumentJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /**
     * Overall attempt ceiling. Set well above {@see $maxExceptions} so Retry-After
     * releases (rate limits) have room without tripping the real-failure budget,
     * yet bounded so a source that throttles us forever still gives up.
     */
    public int $tries = 25;

    /** Real errors fail after three — the §19 "retry ×3 backoff → failed". */
    public int $maxExceptions = 3;

    public function __construct(
        public readonly Document $document,
    ) {}

    /**
     * Backoff between attempts, in seconds.
     *
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 30, 60];
    }

    /**
     * One in-flight import per document.
     */
    public function uniqueId(): string
    {
        return (string) $this->document->id;
    }

    public function handle(DocumentImporter $importer): void
    {
        try {
            $importer->import($this->document);
        } catch (BlockedUrlException $e) {
            // Deterministic: a private/reserved address won't resolve to a public
            // one on the next attempt. Terminal now, no retry, no rethrow.
            $this->markFailed($e->userMessage());
            Log::warning('import.failed', $this->logContext('blocked', $e));
        } catch (RateLimitedException $e) {
            // Not a failure (SPEC 19): back off for the honored Retry-After and
            // resume. The document stays `importing` — the web keeps polling.
            Log::info('import.rate_limited', $this->logContext('rate_limited', $e) + ['retry_after' => $e->retryAfter]);
            $this->release($e->retryAfter);
        }
    }

    /**
     * Runs once the queue exhausts {@see $tries} for a transient failure. A
     * blocked URL never reaches here — handle() swallows it above.
     */
    public function failed(?Throwable $e): void
    {
        $this->markFailed('Import failed — the source could not be reached. Try again.');
        Log::warning('import.failed', $this->logContext('exhausted', $e));
    }

    private function markFailed(string $message): void
    {
        $this->document->forceFill([
            'status' => DocumentStatus::Failed,
            'last_sync_status' => SyncStatus::Failed,
            'sync_error' => $message,
        ])->save();
    }

    /**
     * @return array<string, mixed>
     */
    private function logContext(string $reason, ?Throwable $e): array
    {
        return [
            'document_id' => $this->document->id,
            'connector' => $this->document->source_type->value,
            'reason' => $reason,
            'error' => $e?->getMessage(),
        ];
    }
}
