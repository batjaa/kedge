<?php

namespace Tests\Unit;

use App\Mail\ReviewerMagicLinkMail;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Renders the branded magic-link template for real (no Mail::fake) so a
 * template regression can never ship silently: the CTA URL must appear in
 * both the HTML and plain-text parts, and untrusted inviter/title strings
 * must arrive escaped.
 */
class ReviewerMagicLinkMailTest extends TestCase
{
    private function mailable(): ReviewerMagicLinkMail
    {
        return new ReviewerMagicLinkMail(
            magicLinkUrl: 'https://kedge.test/shared/tok/verify/1/secret',
            documentTitle: 'RFC 017 <Anchoring>',
            inviterName: 'Ada & Co',
            expiresAt: Carbon::parse('2026-08-11 15:30:00', 'UTC'),
        );
    }

    public function test_html_carries_cta_link_brand_frame_and_escaped_fields(): void
    {
        $html = $this->mailable()->render();

        $this->assertStringContainsString('https://kedge.test/shared/tok/verify/1/secret', $html);
        $this->assertStringContainsString('Verify email and open review', $html);
        $this->assertStringContainsString('Comments that keep their place', $html);
        $this->assertStringContainsString('Aug 11, 2026 at 3:30pm', $html);
        // Blade must escape untrusted strings, not interpolate them raw.
        $this->assertStringContainsString('RFC 017 &lt;Anchoring&gt;', $html);
        $this->assertStringContainsString('Ada &amp; Co', $html);
        $this->assertStringNotContainsString('<Anchoring>', $html);
    }

    public function test_text_part_carries_link_and_expiry(): void
    {
        $mailable = $this->mailable();
        $mailable->assertSeeInText('https://kedge.test/shared/tok/verify/1/secret');
        $mailable->assertSeeInText('Aug 11, 2026 at 3:30pm');
        $mailable->assertSeeInText('can be used once');
    }
}
