<?php

namespace Tests\Unit\Import\Normalization;

use App\Services\Import\Normalization\SvgSanitizer;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * SVG assets are sanitized before re-hosting (SPEC 5.2, hard rule #2). Recorded
 * hostile SVG in; the drawing survives, the script surface does not.
 */
class SvgSanitizerTest extends TestCase
{
    private function fixture(): string
    {
        return (string) file_get_contents(__DIR__.'/../../../Fixtures/normalization/hostile.svg');
    }

    #[Test]
    public function it_strips_scripts_handlers_and_hostile_hrefs_but_keeps_the_drawing(): void
    {
        $clean = (new SvgSanitizer)->sanitize($this->fixture());

        $this->assertNotNull($clean);

        // Script surface gone.
        $this->assertStringNotContainsStringIgnoringCase('<script', $clean);
        $this->assertStringNotContainsString('onload', $clean);
        $this->assertStringNotContainsString('onclick', $clean);
        $this->assertStringNotContainsString('javascript:', $clean);
        $this->assertStringNotContainsString("alert('xss')", $clean);

        // The actual graphic survives.
        $this->assertStringContainsString('<rect', $clean);
        $this->assertStringContainsString('<circle', $clean);
        $this->assertStringContainsString('#10b981', $clean);
    }

    #[Test]
    public function it_returns_null_for_input_that_is_not_svg(): void
    {
        $clean = (new SvgSanitizer)->sanitize("\x00\x01 this is not markup at all");

        $this->assertNull($clean);
    }
}
