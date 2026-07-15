<?php

namespace Tests\Unit\Import\Normalization;

use App\Services\Import\Normalization\HtmlNormalizer;
use App\Services\Import\Normalization\ImportWarning;
use League\HTMLToMarkdown\HtmlConverterInterface;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * The HTML→markdown pass on recorded, gnarly real-world HTML (SPEC 5.2): the
 * structural constructs that must survive (headings, tables, nested lists,
 * links, images) and the hostile surface that must vanish (scripts, styles,
 * event handlers, javascript: URLs, iframes). Asserts observable output, never
 * library internals.
 */
class HtmlNormalizerTest extends TestCase
{
    private function fixture(): string
    {
        return (string) file_get_contents(__DIR__.'/../../../Fixtures/normalization/article.html');
    }

    private function convert(string $html): string
    {
        [$markdown] = (new HtmlNormalizer)->toMarkdown($html);

        return $markdown;
    }

    #[Test]
    public function it_converts_headings_tables_and_nested_lists(): void
    {
        $markdown = $this->convert($this->fixture());

        // Headings.
        $this->assertStringContainsString('# Designing the Import Pipeline', $markdown);
        $this->assertStringContainsString('Stages', $markdown);

        // GFM table with its separator row.
        $this->assertStringContainsString('| Stage | Input | Output |', $markdown);
        $this->assertStringContainsString('| Fetch | URL | Bytes |', $markdown);
        $this->assertMatchesRegularExpression('/\|\s*---/', $markdown);

        // Nested list: the child bullet is indented under its parent.
        $this->assertStringContainsString('Rendering never crashes', $markdown);
        $this->assertMatchesRegularExpression('/\n\s{2,}[-*] Unknown fences/', $markdown);

        // Inline emphasis and a real link survive.
        $this->assertStringContainsString('**beautifully**', $markdown);
        $this->assertStringContainsString('[spec](https://kedge.review/spec)', $markdown);
    }

    #[Test]
    public function it_strips_scripts_styles_and_event_handlers(): void
    {
        $markdown = $this->convert($this->fixture());

        $this->assertStringNotContainsStringIgnoringCase('<script', $markdown);
        $this->assertStringNotContainsStringIgnoringCase('<style', $markdown);
        $this->assertStringNotContainsStringIgnoringCase('<iframe', $markdown);
        $this->assertStringNotContainsStringIgnoringCase('<object', $markdown);
        $this->assertStringNotContainsString('onload', $markdown);
        $this->assertStringNotContainsString('onclick', $markdown);
        $this->assertStringNotContainsString('onerror', $markdown);
        $this->assertStringNotContainsString('dataLayer', $markdown);
        $this->assertStringNotContainsString('steal()', $markdown);
        // The inline style value never reaches the output.
        $this->assertStringNotContainsString('color: red', $markdown);
    }

    #[Test]
    public function it_neutralizes_javascript_scheme_links(): void
    {
        $markdown = $this->convert($this->fixture());

        // The sanitizer drops the dangerous href; the link text may remain, but
        // the executable scheme must be gone entirely.
        $this->assertStringNotContainsString('javascript:', $markdown);
        $this->assertStringNotContainsString('alert(document.cookie)', $markdown);
    }

    #[Test]
    public function it_keeps_image_references_for_the_rehoster(): void
    {
        $markdown = $this->convert($this->fixture());

        // Both the absolute and the relative image survive as markdown image
        // syntax (with their hostile attributes stripped) so the re-hoster can
        // resolve and fetch them downstream.
        $this->assertStringContainsString('![Pipeline diagram](https://cdn.example.com/diagram.png)', $markdown);
        $this->assertStringContainsString('![Kedge logo](/assets/relative-logo.svg)', $markdown);
    }

    #[Test]
    public function conversion_failure_degrades_to_recovered_text_with_a_warning(): void
    {
        // Inject a converter that throws to exercise the degrade path (SPEC §19:
        // conversion error → degrade to plain, never fail the import).
        $throwing = new class implements HtmlConverterInterface
        {
            public function convert(string $html): string
            {
                throw new RuntimeException('boom');
            }
        };

        [$markdown, $warnings] = (new HtmlNormalizer(converter: $throwing))
            ->toMarkdown('<h1>Title</h1><p>Body text survives.</p>');

        $this->assertStringContainsString('Body text survives.', $markdown);
        $this->assertCount(1, $warnings);
        $this->assertSame(ImportWarning::HTML_CONVERSION_DEGRADED, $warnings[0]->type);
    }
}
