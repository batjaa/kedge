<?php

namespace App\Services\Import\Connectors;

use App\Enums\SourceType;
use App\Services\Import\Connector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\FetchedContent;

/**
 * Imports content pasted or uploaded straight into Kedge (SPEC 5.1) — a local
 * draft made reviewable before it lives anywhere. There is no URL and no remote to
 * fetch: the controller size-caps the body and stashes it (plus an optional title)
 * in `documents.source_meta`, and this connector reads it back. Keeping it there —
 * rather than only on the version — is what lets a retry re-import identical bytes.
 *
 * Because there is no URL, this connector is never chosen by URL matching
 * ({@see matches()} is always false); the registry resolves it by the stored
 * `upload` source type. Versioning is manual-only — no webhook, no re-sync source.
 */
class UploadConnector implements Connector
{
    public function sourceType(): SourceType
    {
        return SourceType::Upload;
    }

    public function matches(string $url): bool
    {
        // Uploads carry no URL; they are resolved by source type, never matched.
        return false;
    }

    public function fetch(DocumentSource $source): FetchedContent
    {
        $content = $source->meta['content'] ?? null;

        if (! is_string($content)) {
            throw new ImportFailedException('Pasted content is missing from the upload.');
        }

        $title = $source->meta['title'] ?? null;

        return new FetchedContent(
            content: $content,
            mime: 'text/markdown',
            // No source URL: title synthesis falls back to the first heading, and
            // the importer honors an author-provided title when there is one.
            finalUrl: '',
            title: is_string($title) && $title !== '' ? $title : null,
        );
    }

    public function webhookSupported(): bool
    {
        return false;
    }

    public function postComment(DocumentSource $source, string $markdown): void
    {
        // No-op: a pasted document has no upstream to post a digest back to.
    }
}
