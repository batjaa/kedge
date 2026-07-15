<?php

namespace Tests\Unit\Import\Normalization;

use App\Services\Import\Normalization\LinkReWriter;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Relative-link absolutization (#50): a link href written relative to the
 * document's source (`[other](./other.md)`) must render against the source, not
 * the Kedge origin. GitHub blob sources resolve siblings to blob URLs; raw
 * sources to raw siblings; pasted docs (no base) and self-locating hrefs
 * (absolute, protocol-relative, fragment, mailto) are left untouched. Pure text
 * transform — no external seam to fake.
 */
class LinkReWriterTest extends TestCase
{
    private const BLOB_BASE = 'https://github.com/o/r/blob/main/docs/rfc.md';

    private const RAW_BASE = 'https://raw.githubusercontent.com/o/r/main/docs/rfc.md';

    private function rewrite(string $markdown, string $base = self::BLOB_BASE): string
    {
        return (new LinkReWriter)->rewrite($markdown, $base);
    }

    #[Test]
    public function it_resolves_a_sibling_link_against_a_github_blob_base(): void
    {
        $out = $this->rewrite('See [other](./other.md).');

        $this->assertSame('See [other](https://github.com/o/r/blob/main/docs/other.md).', $out);
    }

    #[Test]
    public function it_resolves_a_bare_relative_link_without_dot_slash(): void
    {
        $out = $this->rewrite('[t](other.md)');

        $this->assertSame('[t](https://github.com/o/r/blob/main/docs/other.md)', $out);
    }

    #[Test]
    public function it_resolves_a_parent_relative_link(): void
    {
        $out = $this->rewrite('[up](../a/b.md)');

        $this->assertSame('[up](https://github.com/o/r/blob/main/a/b.md)', $out);
    }

    #[Test]
    public function it_resolves_a_sub_path_link(): void
    {
        $out = $this->rewrite('[deep](sub/file.md)');

        $this->assertSame('[deep](https://github.com/o/r/blob/main/docs/sub/file.md)', $out);
    }

    #[Test]
    public function it_resolves_siblings_to_raw_siblings_for_a_raw_base(): void
    {
        $out = $this->rewrite('[t](./other.md)', self::RAW_BASE);

        $this->assertSame('[t](https://raw.githubusercontent.com/o/r/main/docs/other.md)', $out);
    }

    #[Test]
    public function it_resolves_a_root_relative_link_against_the_origin(): void
    {
        // A leading-slash path is origin-relative per RFC 3986 — documented choice.
        $out = $this->rewrite('[t](/docs/x.md)');

        $this->assertSame('[t](https://github.com/docs/x.md)', $out);
    }

    #[Test]
    public function it_preserves_a_link_title(): void
    {
        $out = $this->rewrite('[t](./other.md "The Title")');

        $this->assertSame('[t](https://github.com/o/r/blob/main/docs/other.md "The Title")', $out);
    }

    #[Test]
    public function it_preserves_angle_bracket_wrapping(): void
    {
        $out = $this->rewrite('[t](<./other.md>)');

        $this->assertSame('[t](<https://github.com/o/r/blob/main/docs/other.md>)', $out);
    }

    #[Test]
    public function it_leaves_a_pure_fragment_untouched(): void
    {
        $md = 'Jump to [section](#anchoring).';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_leaves_an_absolute_url_untouched(): void
    {
        $md = 'Read the [spec](https://example.com/spec.md) online.';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_leaves_mailto_and_tel_links_untouched(): void
    {
        $md = 'Email [us](mailto:hi@example.com) or call [now](tel:+15551234).';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_leaves_a_protocol_relative_url_untouched(): void
    {
        $md = 'Via [cdn](//cdn.example.com/a.md).';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_leaves_everything_untouched_for_a_pasted_document(): void
    {
        // No base URL (upload connector): nothing to resolve against.
        $md = 'A relative [link](./other.md) and a [root](/x.md) one.';

        $this->assertSame($md, $this->rewrite($md, ''));
    }

    #[Test]
    public function it_does_not_treat_an_image_as_a_link(): void
    {
        // Images are the ImageReHoster's job; this pass must not rewrite them.
        $md = '![alt](./diagram.png)';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_rewrites_the_outer_link_of_an_image_as_link_and_keeps_the_image(): void
    {
        // The badge idiom: inner image is carried through verbatim (the image pass
        // rehosts it separately); only the OUTER href is absolutized.
        $out = $this->rewrite('[![alt](/storage/media/1/x.png)](./page.md)');

        $this->assertSame(
            '[![alt](/storage/media/1/x.png)](https://github.com/o/r/blob/main/docs/page.md)',
            $out,
        );
    }

    #[Test]
    public function it_rewrites_a_reference_style_definition(): void
    {
        $md = "See [other][o].\n\n[o]: ./other.md";
        $out = $this->rewrite($md);

        $this->assertSame(
            "See [other][o].\n\n[o]: https://github.com/o/r/blob/main/docs/other.md",
            $out,
        );
    }

    #[Test]
    public function it_rewrites_a_reference_definition_with_title_and_indent(): void
    {
        $out = $this->rewrite('   [o]: ../a/b.md "Title"');

        $this->assertSame('   [o]: https://github.com/o/r/blob/main/a/b.md "Title"', $out);
    }

    #[Test]
    public function it_leaves_an_absolute_reference_definition_untouched(): void
    {
        $md = '[o]: https://example.com/x.md';

        $this->assertSame($md, $this->rewrite($md));
    }

    #[Test]
    public function it_rewrites_multiple_links_in_one_pass(): void
    {
        $out = $this->rewrite('[a](./a.md) and [b](../b.md) and [c](https://x.test/c).');

        $this->assertSame(
            '[a](https://github.com/o/r/blob/main/docs/a.md) and '
            .'[b](https://github.com/o/r/blob/main/b.md) and [c](https://x.test/c).',
            $out,
        );
    }
}
