<?php

namespace App\Services\Import;

use App\Enums\SourceType;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\FetchException;

/**
 * A source Kedge can import from (SPEC 5.1). One implementation per source; the
 * {@see ConnectorRegistry} picks the first whose {@see matches()} accepts a URL.
 *
 * M1 ships {@see Connectors\RawUrlConnector}. GitHub (public + PAT), upload, and
 * the M6 connectors are additive — a new connector implements this interface and
 * registers itself, with no schema or import-flow change. `webhookSupported()`
 * and `postComment()` are the M6 re-sync / digest-post-back seams; connectors
 * without them return false / no-op.
 */
interface Connector
{
    /**
     * The `documents.source_type` this connector produces — also its registry key.
     */
    public function sourceType(): SourceType;

    /**
     * Whether this connector handles the given source URL.
     */
    public function matches(string $url): bool;

    /**
     * Fetch the source content. Throws
     * {@see BlockedUrlException} (deterministic —
     * do not retry) or {@see Exceptions\ImportFailedException} / another
     * {@see FetchException} (transient — retry).
     */
    public function fetch(DocumentSource $source): FetchedContent;

    /**
     * Whether the source can push change notifications (webhooks) for auto
     * re-sync (M6). False for pull-only sources like a raw URL.
     */
    public function webhookSupported(): bool;

    /**
     * Post a review digest back to the source (M6 digest post-back). A no-op seam
     * for sources that cannot receive comments.
     */
    public function postComment(DocumentSource $source, string $markdown): void;
}
