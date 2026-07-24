<?php

namespace App\Jobs;

use App\Enums\AuditEvent;
use App\Enums\SyncStatus;
use App\Models\Document;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\FetchException;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\ProjectionFailedException;
use App\Services\Import\Exceptions\RateLimitedException;
use App\Services\Import\Exceptions\TokenRevokedException;
use App\Services\Import\Exceptions\UnsupportedSourceException;
use App\Services\Reanchor\Exceptions\ReanchorRequestException;
use App\Services\Reanchor\Exceptions\ReanchorUnavailableException;
use App\Services\Resync\ResyncService;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * One in-flight manual re-sync per document. Fetch failures leave the current
 * version intact and mark sync failed; re-anchor endpoint failures retry because
 * the target version may already have been created but is not current yet.
 */
class ResyncDocumentJob implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $maxExceptions = 3;

    public function __construct(
        public readonly Document $document,
        public readonly ?int $actorId = null,
    ) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 30, 60];
    }

    public function uniqueId(): string
    {
        return (string) $this->document->id;
    }

    public function handle(ResyncService $resync): void
    {
        $actor = $this->actor();

        try {
            $resync->resync($this->document, $actor);
        } catch (BlockedUrlException $e) {
            $this->markFailed($e->userMessage(), 'blocked', $e, $actor);
        } catch (TokenRevokedException $e) {
            $this->markFailed($e->userMessage(), 'token_revoked', $e, $actor);
        } catch (RateLimitedException $e) {
            Log::info('resync.rate_limited', $this->logContext('rate_limited', $e) + ['retry_after' => $e->retryAfter]);
            $this->release($e->retryAfter);
        } catch (ReanchorUnavailableException $e) {
            Log::warning('reanchor.failed', $this->logContext('endpoint_unavailable', $e));
            throw $e;
        } catch (ReanchorRequestException $e) {
            $this->markFailed("Re-sync couldn't finish — showing last good version. Try again.", 'reanchor_rejected', $e, $actor);
        } catch (ProjectionFailedException $e) {
            Log::warning('resync.projection_failed', $this->logContext('projection_unavailable', $e));
            throw $e;
        } catch (FetchException|ImportFailedException|UnsupportedSourceException $e) {
            $this->markFailed('Sync failed — showing last good version. Try again.', 'fetch_failed', $e, $actor);
        }
    }

    public function failed(?Throwable $e): void
    {
        $actor = $this->actor();

        if ($e instanceof ReanchorUnavailableException) {
            $this->markFailed("Re-sync couldn't finish — showing last good version. Try again.", 'reanchor_exhausted', $e, $actor);

            return;
        }

        $this->markFailed('Sync failed — showing last good version. Try again.', 'exhausted', $e, $actor);
    }

    private function actor(): ?User
    {
        return $this->actorId === null ? null : User::query()->find($this->actorId);
    }

    private function markFailed(string $message, string $reason, ?Throwable $e, ?User $actor): void
    {
        $this->document->refresh();
        $this->document->forceFill([
            'last_sync_status' => SyncStatus::Failed,
            'sync_error' => $message,
        ])->save();

        Log::warning('resync.failed', $this->logContext($reason, $e));

        // Best-effort: markFailed runs from catch blocks and from the exhausted
        // failed() handler — a throwing audit write there would compound a failure
        // (or throw out of failed()). Audit never affects the re-sync (M3.8 #110).
        app(AuditLogger::class)->recordSafely(
            $this->document->workspace,
            $actor,
            AuditEvent::ResyncFailed,
            $this->document,
            ['reason' => $reason, 'error' => $e?->getMessage()],
        );
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
