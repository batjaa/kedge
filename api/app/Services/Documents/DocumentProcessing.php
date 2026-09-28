<?php

namespace App\Services\Documents;

use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Models\Document;
use Illuminate\Support\Facades\DB;

/**
 * Starts document work with a generation owned by that request. The persisted
 * state is the authoritative status read by the project list; scan reports only
 * say which paths discovery asked us to process.
 */
final class DocumentProcessing
{
    public function startImport(Document $document): int
    {
        return $this->start($document, importing: true);
    }

    public function startResync(Document $document): int
    {
        return $this->start($document, importing: false);
    }

    public function isCurrent(Document $document, ?int $generation): bool
    {
        return $generation === null || Document::query()
            ->whereKey($document->id)
            ->where('sync_generation', $generation)
            ->exists();
    }

    private function start(Document $document, bool $importing): int
    {
        return DB::transaction(function () use ($document, $importing): int {
            $current = Document::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            $generation = (int) $current->sync_generation + 1;

            $current->forceFill([
                ...($importing ? ['status' => DocumentStatus::Importing] : []),
                'last_sync_status' => SyncStatus::Processing,
                'sync_error' => null,
                'sync_generation' => $generation,
                'sync_started_at' => now(),
            ])->save();

            $document->refresh();

            return $generation;
        });
    }
}
