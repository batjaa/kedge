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
    private const URL = 'https://kedge.test/shared/tok/verify/1/secret?expires=1786378753&signature=abc123';

    private function mailable(): ReviewerMagicLinkMail
    {
        return new ReviewerMagicLinkMail(
            magicLinkUrl: self::URL,
            documentTitle: 'RFC 017 <Anchoring>',
            inviterName: 'Ada & Co',
            expiresAt: Carbon::parse('2026-08-11 15:30:00', 'UTC'),
        );
    }

    public function test_html_carries_cta_link_brand_frame_and_escaped_fields(): void
    {
        $html = $this->mailable()->render();

        // In HTML the query-string & is correctly entity-escaped.
        $this->assertStringContainsString('href="'.str_replace('&', '&amp;', self::URL).'"', $html);
        $this->assertStringContainsString('Verify email and open review', $html);
        $this->assertStringContainsString('Comments that keep their place', $html);
        $this->assertStringContainsString('Aug 11, 2026 at 3:30pm', $html);
        // Blade must escape untrusted strings, not interpolate them raw.
        $this->assertStringContainsString('RFC 017 &lt;Anchoring&gt;', $html);
        $this->assertStringContainsString('Ada &amp; Co', $html);
        $this->assertStringNotContainsString('<Anchoring>', $html);
    }

    public function test_text_part_carries_raw_link_and_expiry(): void
    {
        $mailable = $this->mailable();
        // The text/plain part must carry the URL byte-for-byte: an
        // entity-escaped &amp; here breaks the pasted link.
        $mailable->assertSeeInText('expires=1786378753&signature=abc123');
        $mailable->assertDontSeeInText('&amp;');
        $mailable->assertSeeInText('Ada & Co');
        $mailable->assertSeeInText('Aug 11, 2026 at 3:30pm');
        $mailable->assertSeeInText('can be used once');
    }
}
