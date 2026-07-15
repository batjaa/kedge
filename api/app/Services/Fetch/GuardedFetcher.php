<?php

namespace App\Services\Fetch;

use App\Services\Fetch\Exceptions\BlockedUrlException;
use App\Services\Fetch\Exceptions\FetchException;
use App\Services\Fetch\Exceptions\FetchTimeoutException;
use App\Services\Fetch\Exceptions\ResponseTooLargeException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use GuzzleHttp\Psr7\Uri;
use GuzzleHttp\Psr7\UriResolver;
use Illuminate\Support\Facades\Log;

/**
 * The single SSRF-guarded doorway for every outbound fetch in the product —
 * import connectors (#17, #22, #23), image re-hosting (#19), and demo-mode imports
 * (#25) all go through here (SPEC 13). Nothing else in the app should open an
 * outbound HTTP connection to a user-supplied URL.
 *
 * Guarantees per hop, initial request and every redirect alike:
 *   1. Scheme is on the https-only allowlist.
 *   2. The host is resolved once, and EVERY resolved address is checked against
 *      {@see AddressGuard}; any private/reserved/loopback/link-local hit blocks the
 *      whole fetch.
 *   3. The connection is pinned to exactly those validated addresses, so the name
 *      cannot rebind to a private address between the check and the connect.
 *   4. Redirects are followed manually with a hop cap — never auto-followed — so
 *      each new destination runs the full gauntlet again.
 *   5. The body is read against a size cap and aborted mid-stream on overrun; the
 *      transport enforces the connect/transfer timeouts.
 *
 * A blocked fetch logs `ssrf.blocked` (SPEC 19) and throws
 * {@see BlockedUrlException} — the caller-distinguishable signal for
 * "URL not allowed (private address)". Timeouts, oversized bodies, and upstream
 * failures throw their own {@see FetchException}
 * subclasses.
 */
class GuardedFetcher
{
    private const READ_CHUNK_BYTES = 8192;

    public function __construct(
        private readonly DnsResolver $resolver,
        private readonly HttpTransport $transport,
        private readonly AddressGuard $addressGuard,
    ) {}

    /**
     * Fetch a user-supplied URL under the SSRF guard.
     *
     * @param  string  $url  Absolute https URL.
     * @param  array<string, string>  $headers  Request headers to send on every hop (e.g. GitHub's Accept + User-Agent).
     * @param  int|null  $maxBytes  Per-call size-cap override (images and uploads differ); defaults to config.
     * @param  float|null  $timeout  Per-call transfer-timeout override in seconds; defaults to config.
     *
     * @throws BlockedUrlException Scheme/host/address/redirect refused by the guard (logs ssrf.blocked).
     * @throws ResponseTooLargeException Body exceeded the size cap.
     * @throws FetchTimeoutException Connection or transfer timed out.
     * @throws UpstreamFetchException DNS lookup failed or another transport error occurred.
     */
    public function fetch(string $url, array $headers = [], ?int $maxBytes = null, ?float $timeout = null): FetchResult
    {
        $maxBytes = $maxBytes ?? (int) config('kedge.fetch.max_bytes');
        $timeout = $timeout ?? (float) config('kedge.fetch.timeout');
        $connectTimeout = (float) config('kedge.fetch.connect_timeout');
        $maxRedirects = (int) config('kedge.fetch.max_redirects');

        $currentUrl = $url;

        for ($hop = 0; $hop <= $maxRedirects; $hop++) {
            $request = $this->vet($currentUrl, $timeout, $connectTimeout, $headers);
            $response = $this->transport->send($request);

            if ($response->isRedirect() && $response->header('location') !== null) {
                $currentUrl = $this->resolveRedirect($currentUrl, (string) $response->header('location'));
                $response->body->close();

                continue;
            }

            return new FetchResult(
                status: $response->status,
                body: $this->readCapped($response, $maxBytes),
                contentType: $this->contentType($response),
                finalUrl: $currentUrl,
                headers: $response->headers,
            );
        }

        $this->blocked(BlockReason::TooManyRedirects, $currentUrl, 'Exceeded the redirect hop cap.');
    }

    /**
     * Run the full guard on one URL and return a request pinned to its validated
     * addresses. Throws {@see BlockedUrlException} on any policy failure.
     *
     * @param  array<string, string>  $headers
     */
    private function vet(string $url, float $timeout, float $connectTimeout, array $headers = []): PinnedRequest
    {
        $parts = parse_url($url);

        if ($parts === false || ! isset($parts['scheme'])) {
            $this->blocked(BlockReason::DisallowedScheme, $url, 'URL could not be parsed.');
        }

        // TEST-ONLY escape hatch (FETCH_ALLOW_HOSTS — empty in every real
        // deployment, see config/kedge.php): an explicitly allowlisted host skips
        // the private-address rejection below and may be fetched over plain http,
        // so the Playwright journeys (#26, #39) can import a fixture served on
        // loopback. Everything else — redirect re-vetting (a hop OFF the
        // allowlisted host runs the full guard), size caps, timeouts — still
        // applies.
        $allowlistedHost = isset($parts['host'])
            && $this->isAllowlistedHost($this->normalizeHost($parts['host']));

        $scheme = strtolower($parts['scheme']);
        if (! in_array($scheme, config('kedge.fetch.allowed_schemes'), true)
            && ! ($allowlistedHost && $scheme === 'http')) {
            $this->blocked(BlockReason::DisallowedScheme, $url, "Scheme '{$scheme}' is not allowed.");
        }

        if (! isset($parts['host']) || $parts['host'] === '') {
            $this->blocked(BlockReason::MissingHost, $url, 'URL has no host.');
        }

        $host = $this->normalizeHost($parts['host']);
        $port = $parts['port'] ?? ($scheme === 'http' ? 80 : 443);

        $ips = $this->addressesFor($host, $url);

        if (! $allowlistedHost) {
            foreach ($ips as $ip) {
                if (! $this->addressGuard->isAllowed($ip)) {
                    $this->blocked(BlockReason::PrivateAddress, $url, 'Host resolves to a private or reserved address.', [
                        'host' => $host,
                        'resolved_ip' => $ip,
                    ]);
                }
            }
        }

        return new PinnedRequest($url, $host, $port, $ips, $timeout, $connectTimeout, $headers);
    }

    /**
     * True only when the operator explicitly listed this host in
     * FETCH_ALLOW_HOSTS (test-only; empty by default, so this is always false in
     * a real deployment).
     */
    private function isAllowlistedHost(string $host): bool
    {
        /** @var list<string> $hosts */
        $hosts = config('kedge.fetch.allow_hosts', []);

        return $hosts !== [] && in_array(strtolower($host), $hosts, true);
    }

    /**
     * The addresses to validate and pin: the literal itself when the host is an IP,
     * otherwise a single DNS resolution (never re-run — that single result is what
     * gets pinned, closing the rebinding window).
     *
     * @return list<string>
     */
    private function addressesFor(string $host, string $url): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        $ips = $this->resolver->resolve($host);

        if ($ips === []) {
            throw new UpstreamFetchException("Host '{$host}' did not resolve.");
        }

        return $ips;
    }

    /**
     * Read the body up to the size cap, aborting mid-stream on overrun rather than
     * buffering the whole payload first. A Content-Length that already overshoots
     * short-circuits before a single body byte is read.
     */
    private function readCapped(StreamedResponse $response, int $maxBytes): string
    {
        $declared = $response->header('content-length');
        if ($declared !== null && ctype_digit($declared) && (int) $declared > $maxBytes) {
            $response->body->close();

            throw new ResponseTooLargeException("Response declares {$declared} bytes, over the {$maxBytes} cap.");
        }

        $body = '';
        $stream = $response->body;

        while (! $stream->eof()) {
            $chunk = $stream->read(self::READ_CHUNK_BYTES);

            if ($chunk === '') {
                break; // our streams return '' only at EOF
            }

            $body .= $chunk;

            if (strlen($body) > $maxBytes) {
                $stream->close();

                throw new ResponseTooLargeException("Response exceeded the {$maxBytes} byte cap.");
            }
        }

        $stream->close();

        return $body;
    }

    /**
     * Resolve a redirect Location (absolute or relative) against the current URL.
     * The result re-enters the guard on the next loop iteration, so an http:// or
     * private-address redirect is caught there.
     */
    private function resolveRedirect(string $currentUrl, string $location): string
    {
        try {
            return (string) UriResolver::resolve(new Uri($currentUrl), new Uri($location));
        } catch (\InvalidArgumentException) {
            $this->blocked(BlockReason::InvalidRedirect, $currentUrl, 'Redirect Location could not be resolved.');
        }
    }

    private function normalizeHost(string $host): string
    {
        // parse_url keeps the brackets on IPv6 literals; curl's RESOLVE wants them off.
        return trim($host, '[]');
    }

    private function contentType(StreamedResponse $response): ?string
    {
        $value = $response->header('content-type');

        if ($value === null) {
            return null;
        }

        // Strip any "; charset=..." parameter to a bare media type.
        return trim(explode(';', $value, 2)[0]) ?: null;
    }

    /**
     * Log the SSRF rejection as `ssrf.blocked` (SPEC 19) and throw the
     * caller-distinguishable block. The logged URL is redacted of credentials and
     * query string so a token in the URL never reaches the logs (SPEC 13).
     *
     * @param  array<string, mixed>  $context
     */
    private function blocked(BlockReason $reason, string $url, string $message, array $context = []): never
    {
        Log::warning('ssrf.blocked', array_merge([
            'reason' => $reason->value,
            'url' => $this->redact($url),
        ], $context));

        throw new BlockedUrlException($reason, $message);
    }

    /**
     * scheme://host[:port]/path — no userinfo, no query, no fragment.
     */
    private function redact(string $url): string
    {
        $parts = parse_url($url);

        if ($parts === false || ! isset($parts['host'])) {
            return '[unparseable url]';
        }

        $scheme = isset($parts['scheme']) ? $parts['scheme'].'://' : '';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';
        $path = $parts['path'] ?? '';

        return $scheme.$parts['host'].$port.$path;
    }
}
