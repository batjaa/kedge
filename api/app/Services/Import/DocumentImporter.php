<?php

namespace App\Services\Import;

use App\Enums\AuditEvent;
use App\Enums\DocumentFormat;
use App\Enums\DocumentStatus;
use App\Enums\SyncStatus;
use App\Jobs\ImportDocumentJob;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Services\AuditLogger;
use App\Services\Import\Exceptions\UnsupportedSourceException;
use App\Services\Import\Normalization\Normalizer;
use Illuminate\Support\Facades\Log;

/**
 * The heart of the import flow (SPEC 5.3): resolve the connector, fetch, normalize,
 * and land an immutable version — then point the document at it and mark it ready.
 *
 * Normalization (SPEC 5.2) lives behind a single {@see Normalizer} call so this
 * stays a thin orchestrator: `.html` becomes markdown, referenced images are
 * re-hosted, and anything that didn't survive comes back as warnings persisted
 * on the version. A `.md` source still passes straight through (its images
 * excepted). Once content is normalized it is projected to the anchor substrate
 * (#18) — the plain_text every version must carry (SPEC 5.4). MDX hardening
 * (#20) and diagrams (#21) widen the pipeline later without changing this
 * shape. Fetch and projection failures are not caught here — they propagate to
 * {@see ImportDocumentJob}, which owns retry-vs-terminal (SPEC 19).
 */
class DocumentImporter
{
    public function __construct(
        private readonly ConnectorRegistry $registry,
        private readonly TitleSynthesizer $titles,
        private readonly TextProjector $projector,
        private readonly AuditLogger $audit,
        private readonly Normalizer $normalizer,
    ) {}

    public function import(Document $document): void
    {
        $startedAt = microtime(true);

        Log::info('import.started', [
            'document_id' => $document->id,
            'connector' => $document->source_type->value,
        ]);

        $prepared = $this->prepareVersion($document);

        // firstOrCreate honours the (document_id, content_hash) unique constraint:
        // re-importing identical content returns the existing version, no twin.
        $version = DocumentVersion::firstOrCreate(
            ['document_id' => $document->id, 'content_hash' => $prepared->contentHash],
            $prepared->versionAttributes(),
        );

        $document->forceFill([
            'title' => $prepared->title,
            'format' => $prepared->format(),
            'current_version_id' => $version->id,
            'status' => DocumentStatus::Ready,
            'last_sync_status' => SyncStatus::Ok,
            'sync_error' => null,
        ])->save();

        // Did THIS run actually settle the import, or is it a redelivery of a job
        // whose document was already Ready on this version? Only a real transition
        // earns a feed row / M5 notification — a re-run over already-imported
        // content is a no-op save (nothing changed) and stays silent.
        $settledNow = $document->wasChanged(['status', 'current_version_id']);

        Log::info('import.completed', [
            'document_id' => $document->id,
            'connector' => $prepared->connector,
            'duration' => $this->elapsedMs($startedAt),
            'bytes' => strlen($prepared->normalization->content),
            'deduped' => ! $version->wasRecentlyCreated,
        ]);

        // The version has landed and the document is committed as Ready. The trail
        // entry is a post-commit side effect (recordSafely, never record()) so a
        // dead audit sink can never turn a successful import into a job failure /
        // retry. Display snapshot (2A): the freshly-imported title and the
        // requester's name as they read now.
        if ($settledNow) {
            $this->audit->recordSafely(
                $document->workspace,
                $document->creator,
                AuditEvent::DocumentImported,
                $document,
                array_filter([
                    'document_title' => $document->title,
                    'actor_name' => $document->creator?->name,
                ], static fn ($value): bool => $value !== null),
            );
        }
    }

    public function prepareVersion(Document $document): PreparedDocumentVersion
    {
        // Resolve by the document's stored source type, not by re-parsing its URL:
        // it is set once at import time and is the only handle the URL-less upload
        // connector has (SPEC 5.1 — the source type doubles as the registry key).
        $connector = $this->registry->forSourceType($document->source_type)
            ?? throw new UnsupportedSourceException('No connector handles this source.');

        $fetched = $connector->fetch(new DocumentSource(
            url: (string) $document->source_url,
            meta: $document->source_meta ?? [],
            // Bound only for authenticated sources (#23) — the PAT connector reads
            // the token from this integration; null for public/raw/upload.
            integrationId: $document->integration_id,
        ));

        // Normalize beyond bare markdown: HTML → markdown, images re-hosted,
        // warnings collected (SPEC 5.2). Never throws on bad content.
        $normalization = $this->normalizer->normalize($fetched, $document);
        $normalized = $normalization->content;
        $hash = hash('sha256', $normalized);
        $title = $fetched->title ?? $this->titles->fromContent($normalized, $fetched->finalUrl);

        // Project the normalized content to its plain-text anchor substrate
        // (SPEC 5.4). Pass the FRESHLY DETECTED format (not $document->format,
        // which is still the creation-time default): only then does the endpoint
        // run the real MDX compile that fills mdx_ok (#20). A projection failure
        // propagates to the caller's failure handling, so a version never lands
        // without its plain_text.
        $isMdx = $normalization->format === DocumentFormat::Mdx;
        $projection = $this->projector->project($normalized, $normalization->format);

        // A rejected or uncompilable MDX document is not an import/re-sync
        // failure — it renders as plain-markdown fallback. Record it from the
        // shared preparation path so both flows stay observable.
        if ($isMdx && ! $projection->mdxOk) {
            Log::warning('mdx.compile_failed', [
                'document_id' => $document->id,
                'connector' => $connector->sourceType()->value,
            ]);
        }

        return new PreparedDocumentVersion(
            connector: $connector->sourceType()->value,
            fetched: $fetched,
            normalization: $normalization,
            projection: $projection,
            contentHash: $hash,
            title: $title,
            isMdx: $isMdx,
        );
    }

    private function elapsedMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
