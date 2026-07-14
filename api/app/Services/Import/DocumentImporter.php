<?php

namespace App\Services\Import;

use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Services\AuditLogger;
use App\Services\Import\Exceptions\UnsupportedSourceException;
use Illuminate\Support\Facades\Log;

/**
 * The heart of the import flow (SPEC 5.3): resolve the connector, fetch, normalize,
 * and land an immutable version — then point the document at it and mark it ready.
 *
 * M1's normalization is deliberately thin: a `.md` source is stored as-is
 * (`content_raw` == `content_normalized`), and `content_hash` is
 * sha256(normalized). HTML/image handling (#19), MDX hardening (#20), and
 * diagrams (#21) widen the normalization step later without changing this shape.
 * Once content is normalized it is projected to the anchor substrate (#18) — the
 * plain_text every version must carry (SPEC §5.4). Fetch and projection failures
 * are not caught here — they propagate to {@see ImportDocumentJob}, which owns
 * retry-vs-terminal (SPEC 19).
 */
class DocumentImporter
{
    public function __construct(
        private readonly ConnectorRegistry $registry,
        private readonly TitleSynthesizer $titles,
        private readonly TextProjector $projector,
        private readonly AuditLogger $audit,
    ) {}

    public function import(Document $document): void
    {
        $connector = $this->registry->match((string) $document->source_url)
            ?? throw new UnsupportedSourceException('No connector handles this source.');

        $startedAt = microtime(true);
        Log::info('import.started', [
            'document_id' => $document->id,
            'connector' => $connector->sourceType()->value,
        ]);

        $fetched = $connector->fetch(new DocumentSource(
            url: (string) $document->source_url,
            meta: $document->source_meta ?? [],
        ));

        // .md is stored as-is (SPEC 5.2); richer formats normalize in later tickets.
        $normalized = $fetched->content;
        $hash = hash('sha256', $normalized);
        $title = $fetched->title ?? $this->titles->fromContent($normalized, $fetched->finalUrl);

        // Project the normalized content to its plain-text anchor substrate
        // (SPEC 5.4). A projection failure is transient — it propagates to the
        // job's retry path — so a version never lands without its plain_text.
        $projection = $this->projector->project($normalized, $document->format);

        // firstOrCreate honours the (document_id, content_hash) unique constraint:
        // re-importing identical content returns the existing version, no twin.
        $version = DocumentVersion::firstOrCreate(
            ['document_id' => $document->id, 'content_hash' => $hash],
            [
                'content_raw' => $fetched->content,
                'content_normalized' => $normalized,
                'plain_text' => $projection->plainText,
                'projection_version' => $projection->projectionVersion,
                'source_version' => $fetched->sourceVersion,
                'synced_at' => now(),
            ],
        );

        $document->forceFill([
            'title' => $title,
            'current_version_id' => $version->id,
            'status' => DocumentStatus::Ready,
            'last_sync_status' => SyncStatus::Ok,
            'sync_error' => null,
        ])->save();

        Log::info('import.completed', [
            'document_id' => $document->id,
            'connector' => $connector->sourceType()->value,
            'duration' => $this->elapsedMs($startedAt),
            'bytes' => strlen($normalized),
            'deduped' => ! $version->wasRecentlyCreated,
        ]);

        $this->audit->record($document->workspace, $document->creator, 'document.imported', $document);
    }

    private function elapsedMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
