<?php

namespace App\Services\Resync;

use App\Enums\AnchorState;
use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Models\Anchor;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Import\DocumentImporter;
use App\Services\Reanchor\Exceptions\ReanchorUnavailableException;
use App\Services\Reanchor\ReanchorClient;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Manual re-sync orchestration. It deliberately lands/projections the target
 * version before re-anchoring, but flips documents.current_version_id only after
 * target-version anchors are persisted.
 */
class ResyncService
{
    public function __construct(
        private readonly DocumentImporter $importer,
        private readonly ReanchorClient $reanchor,
        private readonly AuditLogger $audit,
    ) {}

    public function resync(Document $document, ?User $actor): void
    {
        $document->refresh();
        $current = $this->currentVersion($document);
        $startedAt = microtime(true);

        Log::info('resync.started', [
            'document_id' => $document->id,
            'connector' => $document->source_type->value,
        ]);
        $this->audit->record($document->workspace, $actor, 'resync.started', $document, [
            'connector' => $document->source_type->value,
        ]);

        $prepared = $this->importer->prepareVersion($document);

        if ($prepared->contentHash === $current->content_hash) {
            $document->forceFill([
                'last_sync_status' => SyncStatus::Ok,
                'sync_error' => null,
            ])->save();

            $this->logCompleted($document, $prepared->connector, $startedAt, deduped: true);
            $this->audit->record($document->workspace, $actor, 'resync.completed', $document, [
                'connector' => $prepared->connector,
                'duration' => $this->elapsedMs($startedAt),
                'deduped' => true,
            ]);

            return;
        }

        $target = DocumentVersion::firstOrCreate(
            ['document_id' => $document->id, 'content_hash' => $prepared->contentHash],
            $prepared->versionAttributes((int) $current->id),
        );

        $currentAnchors = $this->currentAnchors($document, $current);
        $results = $this->reanchor->reanchor(
            $this->reanchorPayload($currentAnchors),
            (string) $target->plain_text,
        );
        $this->ensureCompleteResults($currentAnchors, $results);

        $counts = ['anchored' => 0, 'relocated' => 0, 'orphaned' => 0];
        $anchorsByThread = $currentAnchors->keyBy(fn (Anchor $anchor) => (int) $anchor->thread_id);

        DB::transaction(function () use ($document, $current, $target, $prepared, $results, $anchorsByThread, &$counts): void {
            foreach ($results as $result) {
                /** @var Anchor|null $sourceAnchor */
                $sourceAnchor = $anchorsByThread->get($result['threadId']);
                if (! $sourceAnchor) {
                    continue;
                }

                $state = AnchorState::from($result['state']);
                $counts[$state->value]++;

                Anchor::create([
                    'thread_id' => $sourceAnchor->thread_id,
                    'document_version_id' => $target->id,
                    'exact' => $result['exact'],
                    'prefix' => $result['prefix'],
                    'suffix' => $result['suffix'],
                    'start' => $result['start'],
                    'end' => $result['end'],
                    'heading_path' => $sourceAnchor->heading_path ?? [],
                    'projection_version' => (string) $target->projection_version,
                    'state' => $state,
                ]);
            }

            // The critical gate: only after the target anchors above are durable
            // does the document begin rendering the target version.
            $document->forceFill([
                'title' => $prepared->title,
                'format' => $prepared->format(),
                'current_version_id' => $target->id,
                'status' => DocumentStatus::Ready,
                'last_sync_status' => SyncStatus::Ok,
                'sync_error' => null,
            ])->save();

            Log::info('reanchor.completed', [
                'document_id' => $document->id,
                'from_version_id' => $current->id,
                'to_version_id' => $target->id,
                ...$counts,
            ]);
        });

        $this->audit->record($document->workspace, $actor, 'reanchor.completed', $document, [
            'from_version_id' => $current->id,
            'to_version_id' => $target->id,
            ...$counts,
        ]);

        $this->logCompleted($document, $prepared->connector, $startedAt, deduped: false);
        $this->audit->record($document->workspace, $actor, 'resync.completed', $document, [
            'connector' => $prepared->connector,
            'duration' => $this->elapsedMs($startedAt),
            'deduped' => false,
        ]);
    }

    private function currentVersion(Document $document): DocumentVersion
    {
        return DocumentVersion::query()
            ->whereKey($document->current_version_id)
            ->firstOrFail();
    }

    /**
     * @return Collection<int, Anchor>
     */
    private function currentAnchors(Document $document, DocumentVersion $current): Collection
    {
        return Anchor::query()
            ->where('document_version_id', $current->id)
            ->whereHas('thread', fn ($query) => $query->where('document_id', $document->id))
            ->orderBy('thread_id')
            ->orderByDesc('id')
            ->get()
            ->unique('thread_id')
            ->values();
    }

    /**
     * @param  Collection<int, Anchor>  $anchors
     * @return list<array{threadId: int, exact: string, prefix: ?string, suffix: ?string, start: int, end: int}>
     */
    private function reanchorPayload(Collection $anchors): array
    {
        return $anchors
            ->map(fn (Anchor $anchor): array => [
                'threadId' => (int) $anchor->thread_id,
                'exact' => (string) $anchor->exact,
                'prefix' => $anchor->prefix,
                'suffix' => $anchor->suffix,
                'start' => (int) $anchor->start,
                'end' => (int) $anchor->end,
            ])
            ->values()
            ->all();
    }

    /**
     * @param  Collection<int, Anchor>  $anchors
     * @param  list<array{threadId: int, state: string, exact: string, prefix: ?string, suffix: ?string, start: int, end: int}>  $results
     */
    private function ensureCompleteResults(Collection $anchors, array $results): void
    {
        $expected = $anchors->map(fn (Anchor $anchor): int => (int) $anchor->thread_id)->sort()->values()->all();
        $actual = collect($results)->map(fn (array $result): int => $result['threadId'])->sort()->values()->all();

        if ($expected !== $actual) {
            throw new ReanchorUnavailableException('Re-anchor endpoint returned an incomplete result set.');
        }
    }

    private function logCompleted(Document $document, string $connector, float $startedAt, bool $deduped): void
    {
        Log::info('resync.completed', [
            'document_id' => $document->id,
            'connector' => $connector,
            'duration' => $this->elapsedMs($startedAt),
            'deduped' => $deduped,
        ]);
    }

    private function elapsedMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
