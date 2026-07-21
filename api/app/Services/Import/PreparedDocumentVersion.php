<?php

namespace App\Services\Import;

use App\Enums\DocumentFormat;
use App\Enums\VersionKind;
use App\Services\Import\Normalization\NormalizationResult;

/**
 * Fetch + normalize + project output shared by first import and manual re-sync.
 * The web projection call stays in exactly one pipeline; callers decide when the
 * resulting version becomes current.
 */
class PreparedDocumentVersion
{
    public function __construct(
        public readonly string $connector,
        public readonly FetchedContent $fetched,
        public readonly NormalizationResult $normalization,
        public readonly ProjectionResult $projection,
        public readonly string $contentHash,
        public readonly string $title,
        public readonly bool $isMdx,
    ) {}

    public function format(): DocumentFormat
    {
        return $this->normalization->format;
    }

    /**
     * @return array<string, mixed>
     */
    public function versionAttributes(?int $parentVersionId = null): array
    {
        return [
            'kind' => VersionKind::Mainline,
            'parent_version_id' => $parentVersionId,
            'content_raw' => $this->fetched->content,
            'content_normalized' => $this->normalization->content,
            'plain_text' => $this->projection->plainText,
            'projection_version' => $this->projection->projectionVersion,
            'mdx_ok' => $this->isMdx ? $this->projection->mdxOk : null,
            'import_warnings' => $this->normalization->warningsForStorage(),
            'source_version' => $this->fetched->sourceVersion,
            'synced_at' => now(),
        ];
    }
}
