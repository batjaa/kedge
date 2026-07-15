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
 *   3. Absolutize relative link hrefs ({@see LinkReWriter}) against the source
 *      URL, so `[other](./other.md)` points back at the source's sibling rather
 *      than 404ing on the Kedge origin (#50). Runs after image re-hosting and
 *      touches only links (never `![…]` images), so the two passes don't overlap.
 *
 * Nothing here throws for bad content: HTML that won't convert degrades to
 * recovered text, and images that won't fetch stay as their original URL — both
 * as warnings on the returned {@see NormalizationResult}. Link rewriting is a
 * pure text transform with no fetch, so it never warns.
 */
class Normalizer
{
    public function __construct(
        private readonly HtmlNormalizer $html,
        private readonly ImageReHoster $images,
        private readonly LinkReWriter $links,
    ) {}

    public function normalize(FetchedContent $fetched, Document $document): NormalizationResult
    {
        /** @var list<ImportWarning> $warnings */
        $warnings = [];

        if ($this->looksLikeHtml($fetched)) {
            [$markdown, $htmlWarnings] = $this->html->toMarkdown($fetched->content);
            $warnings = array_merge($warnings, $htmlWarnings);
            $format = DocumentFormat::Html;
        } elseif ($this->looksLikeMdx($fetched)) {
            // `.mdx` is stored as-is like markdown, but the format flag routes it
            // through the hardened MDX render path — where it is compiled,
            // allowlisted, and validated for the mdx_ok gate (#20, SPEC 6.1).
            $markdown = $fetched->content;
            $format = DocumentFormat::Mdx;
        } else {
            $markdown = $fetched->content;
            $format = DocumentFormat::Md;
        }

        [$rehosted, $imageWarnings] = $this->images->rehost($markdown, $document, $fetched->finalUrl);
        $warnings = array_merge($warnings, $imageWarnings);

        // Absolutize relative link hrefs against the source URL (#50). Non-image
        // links only, so it composes cleanly with the image pass above.
        $linked = $this->links->rewrite($rehosted, $fetched->finalUrl);

        return new NormalizationResult($linked, $format, $warnings);
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

        return in_array($this->extensionOf($fetched->finalUrl), ['html', 'htm', 'xhtml'], true);
    }

    /**
     * MDX by URL/filename extension (SPEC 5.2, #20). There is no registered MDX
     * mime type, so the `.mdx` extension is the signal; a URL-less upload has no
     * extension and stays markdown.
     */
    private function looksLikeMdx(FetchedContent $fetched): bool
    {
        return $this->extensionOf($fetched->finalUrl) === 'mdx';
    }

    private function extensionOf(string $url): string
    {
        return strtolower((string) pathinfo(
            (string) parse_url($url, PHP_URL_PATH),
            PATHINFO_EXTENSION,
        ));
    }
}
