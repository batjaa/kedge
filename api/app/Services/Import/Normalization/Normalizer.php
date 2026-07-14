<?php

namespace App\Services\Import\Normalization;

use App\Enums\DocumentFormat;
use App\Models\Document;
use App\Services\Import\DocumentImporter;
use App\Services\Import\FetchedContent;

/**
 * The one entry point the importer calls to turn fetched source into the
 * markdown that renders (SPEC 5.2). It owns the "beyond bare markdown" work so
 * {@see DocumentImporter} stays a thin orchestrator with a
 * single call site:
 *
 *   1. Recognise the format. `.html` (by content type or URL extension) is
 *      sanitized and converted to markdown ({@see HtmlNormalizer}); everything
 *      else is treated as markdown and stored as-is (hardened `.mdx` handling is
 *      #20 — this module leaves that substrate untouched).
 *   2. Re-host every referenced image ({@see ImageReHoster}) so the document
 *      doesn't depend on its origin, collecting a warning for each one that
 *      doesn't survive.
 *
 * Nothing here throws for bad content: HTML that won't convert degrades to
 * recovered text, and images that won't fetch stay as their original URL — both
 * as warnings on the returned {@see NormalizationResult}.
 */
class Normalizer
{
    public function __construct(
        private readonly HtmlNormalizer $html,
        private readonly ImageReHoster $images,
    ) {}

    public function normalize(FetchedContent $fetched, Document $document): NormalizationResult
    {
        /** @var list<ImportWarning> $warnings */
        $warnings = [];

        if ($this->looksLikeHtml($fetched)) {
            [$markdown, $htmlWarnings] = $this->html->toMarkdown($fetched->content);
            $warnings = array_merge($warnings, $htmlWarnings);
            $format = DocumentFormat::Html;
        } else {
            $markdown = $fetched->content;
            $format = DocumentFormat::Md;
        }

        [$rehosted, $imageWarnings] = $this->images->rehost($markdown, $document, $fetched->finalUrl);
        $warnings = array_merge($warnings, $imageWarnings);

        return new NormalizationResult($rehosted, $format, $warnings);
    }

    /**
     * HTML by content type or by URL extension. Confluence storage format and
     * other rich sources arrive later (SPEC 5.2, M6); today it's HTML or markdown.
     */
    private function looksLikeHtml(FetchedContent $fetched): bool
    {
        $mime = strtolower(trim((string) $fetched->mime));
        if ($mime === 'text/html' || $mime === 'application/xhtml+xml') {
            return true;
        }

        $extension = strtolower((string) pathinfo(
            (string) parse_url($fetched->finalUrl, PHP_URL_PATH),
            PATHINFO_EXTENSION,
        ));

        return in_array($extension, ['html', 'htm', 'xhtml'], true);
    }
}
