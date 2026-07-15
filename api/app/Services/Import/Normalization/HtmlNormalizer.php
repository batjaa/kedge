<?php

namespace App\Services\Import\Normalization;

use League\HTMLToMarkdown\Converter\TableConverter;
use League\HTMLToMarkdown\HtmlConverter;
use League\HTMLToMarkdown\HtmlConverterInterface;
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerInterface;
use Throwable;

/**
 * Turns an untrusted `.html` source into normalized markdown (SPEC 5.2).
 *
 * Two passes, both mandatory:
 *   1. **Sanitize** with symfony/html-sanitizer against a safe-element allowlist.
 *      `<script>`/`<style>`/`<iframe>` and every event handler and inline style
 *      are dropped, `javascript:`/`data:` URLs are refused — the markdown
 *      converter never sees a live attribute (hard rule #2).
 *   2. **Convert** the sanitized HTML with league/html-to-markdown, with GFM
 *      table support wired in so real-world docs (tables, nested lists) survive.
 *
 * Conversion never fails the import: if either pass throws, we degrade to the
 * source stripped to recovered plain text plus a warning (SPEC 5.2, §19
 * "conversion error → degrade to raw/plain").
 */
class HtmlNormalizer
{
    private readonly HtmlSanitizerInterface $sanitizer;

    private readonly HtmlConverterInterface $converter;

    public function __construct(
        ?HtmlSanitizerInterface $sanitizer = null,
        ?HtmlConverterInterface $converter = null,
    ) {
        $this->sanitizer = $sanitizer ?? self::defaultSanitizer();
        $this->converter = $converter ?? self::defaultConverter();
    }

    /**
     * @return array{0: string, 1: list<ImportWarning>}
     */
    public function toMarkdown(string $html): array
    {
        try {
            $safe = $this->sanitizer->sanitize($html);
            $markdown = $this->converter->convert($safe);

            return [$this->tidy($markdown), []];
        } catch (Throwable $e) {
            // Degrade rather than fail: recover whatever text we can so the
            // import still lands a readable version (SPEC §19).
            $recovered = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5));

            return [
                $recovered === '' ? '' : $recovered."\n",
                [ImportWarning::htmlConversionDegraded($e->getMessage())],
            ];
        }
    }

    private function tidy(string $markdown): string
    {
        $trimmed = trim($markdown);

        return $trimmed === '' ? '' : $trimmed."\n";
    }

    private static function defaultSanitizer(): HtmlSanitizerInterface
    {
        // allowSafeElements() is a curated allowlist (headings, paragraphs,
        // lists, tables, code, blockquotes, links, images, emphasis) that already
        // excludes script/style/event-handlers; relative links and medias stay so
        // origin-relative image URLs reach the re-hoster to be resolved and
        // fetched.
        $config = (new HtmlSanitizerConfig)
            ->allowSafeElements()
            ->allowRelativeLinks()
            ->allowRelativeMedias();

        return new HtmlSanitizer($config);
    }

    private static function defaultConverter(): HtmlConverterInterface
    {
        $converter = new HtmlConverter([
            // Drop any tag the converter doesn't understand, keeping its text —
            // no raw HTML leaks into the markdown.
            'strip_tags' => true,
            'hard_break' => true,
            'header_style' => 'atx',
        ]);
        $converter->getEnvironment()->addConverter(new TableConverter);

        return $converter;
    }
}
