<?php

namespace Tests\Feature\Fetch;

use App\Services\Fetch\AddressGuard;
use App\Services\Fetch\BlockReason;
use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\FetchTimeoutException;
use App\Services\Fetch\Exceptions\ResponseTooLargeException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use App\Services\Fetch\GuardedFetcher;
use GuzzleHttp\Psr7\PumpStream;
use Illuminate\Support\Facades\Log;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * The SSRF suite (SPEC 18.6, issue #16): scheme allowlist, private-range blocks,
 * the DNS resolve-then-pin guarantee, redirect-hop re-validation, and the size /
 * timeout caps — all asserted as external behaviour of the fetcher (what it
 * returns, throws, pins, and logs) via a faked DNS boundary and a faked HTTP
 * boundary.
 */
class GuardedFetcherTest extends TestCase
{
    private FakeDnsResolver $dns;

    private FakeHttpTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = new FakeDnsResolver;
        $this->transport = new FakeHttpTransport;
    }

    private function fetcher(): GuardedFetcher
    {
        return new GuardedFetcher($this->dns, $this->transport, new AddressGuard);
    }

    // --- Happy path ---------------------------------------------------------

    public function test_fetches_a_public_https_url_and_pins_to_the_resolved_ip(): void
    {
        $this->dns->set('example.com', ['93.184.216.34']);
        $this->transport->respond(200, ['Content-Type' => 'text/markdown; charset=utf-8'], '# Hello');

        $result = $this->fetcher()->fetch('https://example.com/spec.md');

        $this->assertSame(200, $result->status);
        $this->assertSame('# Hello', $result->body);
        $this->assertSame('text/markdown', $result->contentType);
        $this->assertSame('https://example.com/spec.md', $result->finalUrl);
        $this->assertTrue($result->successful());

        // The connection was pinned to the validated IP, Host preserved.
        $request = $this->transport->lastRequest();
        $this->assertSame(['93.184.216.34'], $request->pinnedIps);
        $this->assertSame('example.com', $request->host);
        $this->assertSame(443, $request->port);
    }

    public function test_returns_non_2xx_responses_without_throwing(): void
    {
        // Callers (connectors) need the status to honour Retry-After on 403/429.
        $this->dns->set('example.com', ['93.184.216.34']);
        $this->transport->respond(404, ['Content-Type' => 'text/plain'], 'Not Found');

        $result = $this->fetcher()->fetch('https://example.com/missing.md');

        $this->assertSame(404, $result->status);
        $this->assertFalse($result->successful());
        $this->assertSame('Not Found', $result->body);
    }

    // --- Scheme allowlist ---------------------------------------------------

    public function test_blocks_non_https_scheme(): void
    {
        try {
            $this->fetcher()->fetch('http://example.com/spec.md');
            $this->fail('Expected BlockedUrlException');
        } catch (BlockedUrlException $e) {
            $this->assertSame(BlockReason::DisallowedScheme, $e->reason);
        }

        $this->assertSame([], $this->transport->requests, 'no connection should be attempted');
    }

    public function test_blocks_non_web_schemes(): void
    {
        foreach (['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com/x'] as $url) {
            try {
                $this->fetcher()->fetch($url);
                $this->fail("Expected BlockedUrlException for {$url}");
            } catch (BlockedUrlException $e) {
                $this->assertSame(BlockReason::DisallowedScheme, $e->reason);
            }
        }
    }

    // --- Private / reserved ranges ------------------------------------------

    public function test_blocks_host_that_resolves_to_a_private_range(): void
    {
        $this->dns->set('internal.corp', ['10.0.0.5']);

        try {
            $this->fetcher()->fetch('https://internal.corp/secrets');
            $this->fail('Expected BlockedUrlException');
        } catch (BlockedUrlException $e) {
            $this->assertSame(BlockReason::PrivateAddress, $e->reason);
        }

        $this->assertSame([], $this->transport->requests, 'must block before connecting');
    }

    public function test_blocks_loopback_ip_literal(): void
    {
        $e = $this->assertBlocks('https://127.0.0.1/');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
        $this->assertSame([], $this->transport->requests);
    }

    public function test_blocks_cloud_metadata_ip_literal(): void
    {
        $e = $this->assertBlocks('https://169.254.169.254/latest/meta-data/');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
    }

    public function test_blocks_ipv6_loopback_literal(): void
    {
        $e = $this->assertBlocks('https://[::1]/');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
    }

    public function test_blocks_when_any_resolved_address_is_private(): void
    {
        // Attacker returns a decoy public IP alongside a private one.
        $this->dns->set('mixed.test', ['93.184.216.34', '169.254.169.254']);

        $e = $this->assertBlocks('https://mixed.test/');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
        $this->assertSame([], $this->transport->requests);
    }

    // --- DNS resolve-then-pin (rebinding) -----------------------------------

    public function test_resolves_once_and_pins_defeating_dns_rebinding(): void
    {
        // First resolution is public (passes); a re-resolution would return the
        // metadata endpoint. Pinning means we never re-resolve, so the fetch uses
        // the validated public IP and succeeds.
        $this->dns->set('rebind.test', ['93.184.216.34']); // first call
        $this->dns->set('rebind.test', ['169.254.169.254']); // would-be rebind
        $this->transport->respond(200, ['Content-Type' => 'text/plain'], 'ok');

        $result = $this->fetcher()->fetch('https://rebind.test/doc');

        $this->assertSame('ok', $result->body);
        $this->assertSame(1, $this->dns->callCount('rebind.test'), 'resolved exactly once');
        $this->assertSame(['93.184.216.34'], $this->transport->lastRequest()->pinnedIps);
    }

    // --- Redirect hops re-validated -----------------------------------------

    public function test_follows_a_redirect_to_another_public_host(): void
    {
        $this->dns->set('start.test', ['93.184.216.34']);
        $this->dns->set('final.test', ['8.8.8.8']);

        $this->transport->redirectTo('https://final.test/moved');
        $this->transport->respond(200, ['Content-Type' => 'text/html'], '<h1>Here</h1>');

        $result = $this->fetcher()->fetch('https://start.test/doc');

        $this->assertSame('<h1>Here</h1>', $result->body);
        $this->assertSame('https://final.test/moved', $result->finalUrl);
        $this->assertCount(2, $this->transport->requests);
        $this->assertSame(['8.8.8.8'], $this->transport->lastRequest()->pinnedIps);
    }

    public function test_blocks_a_redirect_to_a_private_host(): void
    {
        $this->dns->set('start.test', ['93.184.216.34']);
        $this->dns->set('internal.test', ['10.1.2.3']);

        $this->transport->redirectTo('https://internal.test/');

        $e = $this->assertBlocks('https://start.test/doc');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
        $this->assertCount(1, $this->transport->requests, 'only the first hop connected');
    }

    public function test_blocks_a_redirect_to_the_metadata_ip(): void
    {
        $this->dns->set('start.test', ['93.184.216.34']);
        $this->transport->redirectTo('https://169.254.169.254/latest/meta-data/');

        $e = $this->assertBlocks('https://start.test/doc');
        $this->assertSame(BlockReason::PrivateAddress, $e->reason);
    }

    public function test_blocks_a_redirect_that_downgrades_to_http(): void
    {
        $this->dns->set('start.test', ['93.184.216.34']);
        $this->transport->redirectTo('http://start.test/insecure');

        $e = $this->assertBlocks('https://start.test/doc');
        $this->assertSame(BlockReason::DisallowedScheme, $e->reason);
    }

    public function test_resolves_relative_redirect_against_the_current_url(): void
    {
        $this->dns->set('start.test', ['93.184.216.34']);
        $this->transport->redirectTo('/moved/here');
        $this->transport->respond(200, [], 'landed');

        $result = $this->fetcher()->fetch('https://start.test/docs/original');

        $this->assertSame('landed', $result->body);
        $this->assertSame('https://start.test/moved/here', $result->finalUrl);
    }

    public function test_enforces_the_redirect_hop_cap(): void
    {
        $this->dns->set('loop.test', ['93.184.216.34']);
        for ($i = 0; $i < 8; $i++) {
            $this->transport->redirectTo('https://loop.test/next');
        }

        $e = $this->assertBlocks('https://loop.test/start');
        $this->assertSame(BlockReason::TooManyRedirects, $e->reason);
    }

    // --- Size cap -----------------------------------------------------------

    public function test_rejects_oversized_response_from_content_length_without_reading_body(): void
    {
        $this->dns->set('example.com', ['93.184.216.34']);

        // If the guard were to read this body, the source throws — so getting
        // ResponseTooLargeException instead proves the Content-Length short-circuit.
        $exploding = new PumpStream(function () {
            throw new \RuntimeException('body must not be read on the fast path');
        });
        $this->transport->respond(200, ['Content-Length' => '2048'], $exploding);

        $this->expectException(ResponseTooLargeException::class);
        $this->fetcher()->fetch('https://example.com/big', maxBytes: 1024);
    }

    public function test_aborts_oversized_response_mid_stream(): void
    {
        $this->dns->set('example.com', ['93.184.216.34']);

        // An effectively unbounded body: the test only terminates because the
        // guard aborts mid-stream once the cap is crossed, never buffering it all.
        $generated = 0;
        $body = new PumpStream(function (int $length) use (&$generated) {
            $generated += $length;

            return str_repeat('x', $length);
        });
        $this->transport->respond(200, [], $body); // no Content-Length

        try {
            $this->fetcher()->fetch('https://example.com/stream', maxBytes: 1024);
            $this->fail('Expected ResponseTooLargeException');
        } catch (ResponseTooLargeException) {
            $this->assertLessThan(100_000, $generated, 'aborted mid-stream, did not drain the body');
        }
    }

    public function test_size_cap_is_overridable_per_call(): void
    {
        $this->dns->set('example.com', ['93.184.216.34']);
        $this->transport->respond(200, ['Content-Type' => 'image/png'], str_repeat('x', 500));

        // 500 bytes is under the default cap and under a 1000-byte override.
        $result = $this->fetcher()->fetch('https://example.com/img.png', maxBytes: 1000);
        $this->assertSame(500, strlen($result->body));
    }

    // --- Timeout / upstream -------------------------------------------------

    public function test_surfaces_a_slow_response_as_a_timeout(): void
    {
        $this->dns->set('slow.test', ['93.184.216.34']);
        $this->transport->fail(new FetchTimeoutException('timed out'));

        $this->expectException(FetchTimeoutException::class);
        $this->fetcher()->fetch('https://slow.test/doc');
    }

    public function test_surfaces_transport_failure_as_upstream_exception(): void
    {
        $this->dns->set('down.test', ['93.184.216.34']);
        $this->transport->fail(new UpstreamFetchException('connection refused'));

        $this->expectException(UpstreamFetchException::class);
        $this->fetcher()->fetch('https://down.test/doc');
    }

    public function test_unresolvable_host_is_an_upstream_error_not_a_block(): void
    {
        // Empty resolution — host does not exist. Not an SSRF attempt.
        $this->dns->set('nope.test', []);

        $this->expectException(UpstreamFetchException::class);
        $this->fetcher()->fetch('https://nope.test/doc');
    }

    // --- Logging ------------------------------------------------------------

    public function test_blocked_fetch_logs_ssrf_blocked_with_redacted_url(): void
    {
        Log::spy();

        $this->dns->set('internal.corp', ['10.0.0.5']);

        try {
            $this->fetcher()->fetch('https://internal.corp/path?token=supersecret');
        } catch (BlockedUrlException) {
            // expected
        }

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) {
                return $message === 'ssrf.blocked'
                    && $context['reason'] === BlockReason::PrivateAddress->value
                    && $context['url'] === 'https://internal.corp/path' // query/token stripped
                    && ! str_contains(json_encode($context), 'supersecret');
            })
            ->once();
    }

    public function test_blocked_exception_exposes_a_uniform_user_message(): void
    {
        $this->dns->set('internal.corp', ['10.0.0.5']);

        try {
            $this->fetcher()->fetch('https://internal.corp/x');
            $this->fail('Expected BlockedUrlException');
        } catch (BlockedUrlException $e) {
            $this->assertSame('URL not allowed (private address).', $e->userMessage());
        }
    }

    private function assertBlocks(string $url): BlockedUrlException
    {
        try {
            $this->fetcher()->fetch($url);
        } catch (BlockedUrlException $e) {
            return $e;
        }

        $this->fail("Expected BlockedUrlException for {$url}");
    }
}
