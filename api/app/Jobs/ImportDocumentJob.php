<?php

namespace App\Jobs;

use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Models\Document;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Import\DocumentImporter;
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
 * Failure handling follows the §19 registry:
 *   - A blocked URL is deterministic — it will not become allowed on retry — so
 *     the document is marked failed immediately, with no further attempts.
 *   - Any other fetch/normalize error bubbles up so the queue retries with
 *     backoff; once the {@see $tries} budget is spent, {@see failed()} records the
 *     terminal failure and the web offers a retry CTA.
 */
class ImportDocumentJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /** Retry ×3 with backoff before giving up (SPEC 19). */
    public int $tries = 3;

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
