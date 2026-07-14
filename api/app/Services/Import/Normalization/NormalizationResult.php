<?php

namespace App\Services\Import\Normalization;

use App\Enums\DocumentFormat;

/**
 * The outcome of normalizing one fetched document (SPEC 5.2): the markdown that
 * renders, the format it was recognised as, and every warning collected along
 * the way. The importer hashes {@see $content}, stores it as
 * `content_normalized`, records {@see $warnings} on the version, and sets the
 * document's {@see $format}.
 */
final class NormalizationResult
{
    /**
     * @param  list<ImportWarning>  $warnings
     */
    public function __construct(
        public readonly string $content,
        public readonly DocumentFormat $format,
        public readonly array $warnings = [],
    ) {}

    /**
     * Warnings as the plain `{type, message}` arrays persisted to the version's
     * `import_warnings` JSON column (null when there is nothing to warn about).
     *
     * @return list<array{type: string, message: string}>|null
     */
    public function warningsForStorage(): ?array
    {
        if ($this->warnings === []) {
            return null;
        }

        return array_map(static fn (ImportWarning $w): array => $w->toArray(), $this->warnings);
    }
}
