<?php

namespace Tests\Feature\Import;

use App\Models\Integration;
use App\Services\Fetch\AddressGuard;
use App\Services\Fetch\GuardedFetcher;
use App\Services\Import\Connectors\GithubPatConnector;
use App\Services\Import\DocumentSource;
use App\Services\Import\Exceptions\ImportFailedException;
use App\Services\Import\Exceptions\RateLimitedException;
use App\Services\Import\Exceptions\TokenRevokedException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Fetch\FakeDnsResolver;
use Tests\Support\Fetch\FakeHttpTransport;
use Tests\TestCase;

/**
 * Connector contract tests for the authenticated GitHub source (SPEC §5.1, §18.5,
 * ticket #23). Like the public-connector suite, they run the real
 * {@see GuardedFetcher} with the HTTP boundary faked and replayed from recorded
 * GitHub shapes — but the point here is the credential: the token rides the
 * `Authorization` header, a private file comes back, a 401 is terminal
 * (token-revoked), and the token never reaches the logs (SPEC §13, §19).
 */
class GithubPatConnectorTest extends TestCase
{
    use RefreshDatabase;

    private FakeDnsResolver $dns;

    private FakeHttpTransport $transport;

    private const GITHUB_API_IP = '140.82.112.3';

    private const BLOB_URL = 'https://github.com/acme/private-specs/blob/main/rfc/042-widget.md';

    /** A recognizable token so a log/response scan can prove it is absent. */
    private const TOKEN = 'ghp_liveSECRETtoken0000000000000000abcd';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = new FakeDnsResolver;
        $this->transport = new FakeHttpTransport;
        $this->dns->set('api.github.com', [self::GITHUB_API_IP]);
    }

    private function connector(): GithubPatConnector
    {
        return new GithubPatConnector(
            new GuardedFetcher($this->dns, $this->transport, new AddressGuard),
        );
    }

    private function fixture(string $path): string
    {
        return (string) file_get_contents(base_path("tests/Fixtures/github/{$path}"));
    }

    /** An integration carrying self::TOKEN, and a source bound to it. */
    private function boundSource(): DocumentSource
    {
        $integration = Integration::factory()->withToken(self::TOKEN)->create();

        return new DocumentSource(url: self::BLOB_URL, integrationId: $integration->id);
    }

    // --- Blob-URL matching (shared parsing) ---------------------------------

    public function test_matches_the_same_blob_urls_as_the_public_reader(): void
    {
        $connector = $this->connector();

        $this->assertTrue($connector->matches(self::BLOB_URL));
        $this->assertTrue($connector->matches('https://github.com/o/r/blob/v1.2.3/path/to/file.mdx'));
        $this->assertFalse($connector->matches('https://github.com/o/r'));
        $this->assertFalse($connector->matches('https://raw.githubusercontent.com/o/r/main/README.md'));
    }

    // --- Private-file success + the Authorization header ---------------------

    public function test_fetches_a_private_file_with_the_token_on_the_wire(): void
    {
        $raw = $this->fixture('private-spec.md');
        $this->transport->respond(200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'X-RateLimit-Remaining' => '4999', // authenticated budget, not the anon 60
        ], $raw);

        $fetched = $this->connector()->fetch($this->boundSource());

        $this->assertSame($raw, $fetched->content);
        $this->assertSame('text/plain', $fetched->mime);
        $this->assertSame(self::BLOB_URL, $fetched->finalUrl);

        $request = $this->transport->lastRequest();
        // Parsed to the contents API, exactly as the public reader would.
        $this->assertSame(
            'https://api.github.com/repos/acme/private-specs/contents/rfc/042-widget.md?ref=main',
            $request->url,
        );
        // The distinguishing bit: a Bearer token, alongside the shared headers.
        $this->assertSame('Bearer '.self::TOKEN, $request->headers['Authorization']);
        $this->assertSame('application/vnd.github.raw', $request->headers['Accept']);
        $this->assertSame('Kedge', $request->headers['User-Agent']);
        // Still pinned to the resolved public GitHub address.
        $this->assertSame([self::GITHUB_API_IP], $request->pinnedIps);
    }

    // --- Token-revoked path (SPEC §19) --------------------------------------

    public function test_401_is_a_terminal_token_revoked_failure(): void
    {
        $this->transport->respond(401, [
            'Content-Type' => 'application/json; charset=utf-8',
        ], $this->fixture('errors/unauthorized-401.json'));

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a TokenRevokedException.');
        } catch (TokenRevokedException $e) {
            $this->assertStringContainsString('reconnect', $e->userMessage());
        }
    }

    // --- Rate limiting still backs off (shared with the public reader) -------

    public function test_429_still_backs_off_rather_than_failing(): void
    {
        $this->transport->respond(429, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Retry-After' => '45',
        ], '{"message":"secondary rate limit"}');

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a RateLimitedException.');
        } catch (RateLimitedException $e) {
            $this->assertSame(45, $e->retryAfter);
        }
    }

    public function test_404_is_a_terminal_import_failure(): void
    {
        $this->transport->respond(404, ['Content-Type' => 'application/json'], $this->fixture('errors/not-found-404.json'));

        $this->expectException(ImportFailedException::class);
        $this->connector()->fetch($this->boundSource());
    }

    // --- Forbidden (403, not a rate limit): the token can't reach this file ---

    public function test_403_forbidden_is_a_terminal_access_failure_with_a_reconnect_cta(): void
    {
        // A plain 403 with no rate-limit markers: the PAT authenticated (else 401)
        // but GitHub forbids the read — a fine-grained token missing the repo or
        // Contents:read. Terminal like a revoked token, not a transient retry.
        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
        ], $this->fixture('errors/forbidden-403.json'));

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a TokenRevokedException for a forbidden PAT fetch.');
        } catch (TokenRevokedException $e) {
            $this->assertStringContainsString('reconnect', $e->userMessage());
        }
    }

    public function test_403_surfaces_githubs_own_reason_in_the_user_message(): void
    {
        // The forbidden fixture's body reason — the author needs the specific
        // cause ("Must have admin rights to Repository.") to know what to fix.
        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
        ], $this->fixture('errors/forbidden-403.json'));

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a TokenRevokedException.');
        } catch (TokenRevokedException $e) {
            $this->assertStringContainsString('Must have admin rights to Repository', $e->userMessage());
        }
    }

    public function test_403_reason_from_github_is_sanitized_and_truncated(): void
    {
        // GitHub's body is untrusted text: control chars stripped, length capped,
        // never rendered as markup (SPEC §13, like the Kroki error detail).
        $reason = str_repeat('A', 400)."\n\t<script>evil</script>";
        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
        ], json_encode(['message' => $reason]));

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a TokenRevokedException.');
        } catch (TokenRevokedException $e) {
            $message = $e->userMessage();
            $this->assertLessThan(400, mb_strlen($message));
            $this->assertStringNotContainsString("\n", $message);
            $this->assertStringNotContainsString("\t", $message);
        }
    }

    public function test_a_rate_limit_403_still_backs_off_rather_than_reading_as_forbidden(): void
    {
        // A 403 carrying rate-limit markers is a throttle, not an access failure —
        // handling forbidden 403s must not swallow it into a terminal failure.
        $this->transport->respond(403, [
            'Content-Type' => 'application/json; charset=utf-8',
            'X-RateLimit-Remaining' => '0',
            'X-RateLimit-Reset' => (string) (now()->getTimestamp() + 30),
        ], $this->fixture('errors/rate-limit-403.json'));

        try {
            $this->connector()->fetch($this->boundSource());
            $this->fail('Expected a RateLimitedException for a rate-limited 403.');
        } catch (RateLimitedException $e) {
            $this->assertGreaterThan(0, $e->retryAfter);
        }
    }

    public function test_a_missing_integration_is_an_import_failure_not_an_unauthenticated_call(): void
    {
        // No integration bound: the connector must not silently fetch without a token.
        $this->expectException(ImportFailedException::class);
        $this->connector()->fetch(new DocumentSource(url: self::BLOB_URL, integrationId: null));
    }
}
