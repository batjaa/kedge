<?php

namespace Tests\Feature\Import;

use App\Services\Fetch\AddressGuard;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Connectors\GithubPublicConnector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\RateLimitedException;
use Illuminate\Support\Carbon;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * Connector contract tests for the public-GitHub source (SPEC 5.1, 18.5). They
 * run the connector through the real {@see GuardedFetcher} with the HTTP boundary
 * faked and replayed from recorded GitHub response shapes (headers + bodies), so
 * blob-URL parsing, the raw-media-type request, the SSRF pin, and — the point of
 * the ticket — the rate-limit back-off are all asserted as external behaviour.
 */
class GithubPublicConnectorTest extends TestCase
{
    private FakeDnsResolver $dns;

    private FakeHttpTransport $transport;

    private const GITHUB_API_IP = '140.82.112.3';

    private const BLOB_URL = 'https://github.com/octocat/Hello-World/blob/master/README.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = new FakeDnsResolver;
        $this->transport = new FakeHttpTransport;
        // api.github.com always resolves to a public address; pin to it.
        $this->dns->set('api.github.com', [self::GITHUB_API_IP]);
    }

    private function connector(): GithubPublicConnector
    {
        return new GithubPublicConnector(
            new GuardedFetcher($this->dns, $this->transport, new AddressGuard),
        );
    }

    private function fixture(string $path): string
    {
        return (string) file_get_contents(base_path("tests/Fixtures/github/{$path}"));
    }

    // --- Blob-URL matching --------------------------------------------------

    public function test_matches_public_github_blob_urls(): void
    {
        $connector = $this->connector();

        $this->assertTrue($connector->matches(self::BLOB_URL));
        $this->assertTrue($connector->matches('https://github.com/kedgehq/kedge/blob/main/docs/SPEC.md'));
        $this->assertTrue($connector->matches('https://www.github.com/o/r/blob/v1.2.3/path/to/file.mdx'));
    }

    public function test_ignores_non_blob_and_non_github_urls(): void
    {
        $connector = $this->connector();

        // Repo root, tree view, and issues are not files.
        $this->assertFalse($connector->matches('https://github.com/octocat/Hello-World'));
        $this->assertFalse($connector->matches('https://github.com/octocat/Hello-World/tree/master/docs'));
        // A raw link is a different host — the raw-URL connector's job.
        $this->assertFalse($connector->matches('https://raw.githubusercontent.com/octocat/Hello-World/master/README.md'));
        // Gists and the API host are not blob URLs either.
        $this->assertFalse($connector->matches('https://gist.github.com/octocat/abc123'));
        $this->assertFalse($connector->matches('https://example.com/octocat/Hello-World/blob/master/README.md'));
    }

    // --- Success path -------------------------------------------------------

    public function test_fetches_the_raw_file_through_the_contents_api_pinned(): void
    {
        $raw = $this->fixture('readme-raw.md');
        $this->transport->respond(200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'X-RateLimit-Remaining' => '59',
            'X-GitHub-Media-Type' => 'github.raw',
        ], $raw);

        $fetched = $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL));

        $this->assertSame($raw, $fetched->content);
        $this->assertSame('text/plain', $fetched->mime);
        // finalUrl stays the human blob URL, so filename synthesis is sensible.
        $this->assertSame(self::BLOB_URL, $fetched->finalUrl);

        $request = $this->transport->lastRequest();
        $this->assertSame(
            'https://api.github.com/repos/octocat/Hello-World/contents/README.md?ref=master',
            $request->url,
        );
        // Raw media type requested, with the required User-Agent and API version.
        $this->assertSame('application/vnd.github.raw', $request->headers['Accept']);
        $this->assertSame('Kedge', $request->headers['User-Agent']);
        $this->assertSame('2022-11-28', $request->headers['X-GitHub-Api-Version']);
        // Pinned to the resolved public GitHub address, Host preserved.
        $this->assertSame([self::GITHUB_API_IP], $request->pinnedIps);
        $this->assertSame('api.github.com', $request->host);
    }

    public function test_parses_a_nested_path_and_branch_ref(): void
    {
        $this->transport->respond(200, ['Content-Type' => 'text/plain'], '# Spec');

        $this->connector()->fetch(new DocumentSource(
            url: 'https://github.com/kedgehq/kedge/blob/main/docs/specs/import-render.md',
        ));

        $this->assertSame(
            'https://api.github.com/repos/kedgehq/kedge/contents/docs/specs/import-render.md?ref=main',
            $this->transport->lastRequest()->url,
        );
    }

    // --- Rate limiting (SPEC 19) --------------------------------------------

    public function test_429_with_retry_after_backs_off_for_that_many_seconds(): void
    {
        $this->transport->respond(429, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Retry-After' => '60',
        ], $this->fixture('errors/rate-limit-429.json'));

        try {
            $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL));
            $this->fail('Expected a RateLimitedException.');
        } catch (RateLimitedException $e) {
            $this->assertSame(60, $e->retryAfter);
        }
    }

    public function test_403_primary_rate_limit_backs_off_until_the_reset(): void
    {
        // Primary limit: 403 with no Retry-After, remaining 0, reset an epoch 90s out.
        Carbon::setTestNow(Carbon::createFromTimestamp(1_720_000_000));
        $reset = now()->addSeconds(90)->getTimestamp();

        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
            'X-RateLimit-Remaining' => '0',
            'X-RateLimit-Reset' => (string) $reset,
        ], $this->fixture('errors/rate-limit-403.json'));

        try {
            $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL));
            $this->fail('Expected a RateLimitedException.');
        } catch (RateLimitedException $e) {
            $this->assertSame(90, $e->retryAfter);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_403_forbidden_without_a_rate_limit_marker_is_a_terminal_failure(): void
    {
        // A private repo forbids the read: remaining budget, no Retry-After — real failure.
        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
            'X-RateLimit-Remaining' => '59',
        ], $this->fixture('errors/forbidden-403.json'));

        $this->expectException(ImportFailedException::class);
        $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL));
    }

    public function test_404_is_a_terminal_failure(): void
    {
        $this->transport->respond(404, [
            'Content-Type' => 'application/json; charset=utf-8',
        ], $this->fixture('errors/not-found-404.json'));

        $this->expectException(ImportFailedException::class);
        $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL));
    }
}
