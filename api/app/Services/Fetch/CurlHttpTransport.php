<?php

namespace App\Services\Fetch;

use App\Services\Fetch\Exceptions\FetchTimeoutException;
use App\Services\Fetch\Exceptions\UpstreamFetchException;
use GuzzleHttp\Exception\ConnectException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;

/**
 * The production {@see HttpTransport}: Laravel's HTTP client (Guzzle + curl) doing
 * the actual pin-and-connect.
 *
 * The pin is curl's CURLOPT_RESOLVE — it forces the connection to the pre-validated
 * IP(s) while curl still sends the original Host header, uses the hostname for SNI,
 * and validates the certificate against it. Because the address is supplied by us,
 * curl never performs its own DNS lookup, so there is no window for the name to
 * rebind to a private address between validation and connect.
 *
 * Redirects are disabled (allow_redirects=false): the guard re-validates and
 * re-pins each hop itself. The protocol allowlist and http_errors=false are belt
 * and braces — the guard already rejects non-https, and non-2xx responses are
 * returned so callers can read the status.
 */
class CurlHttpTransport implements HttpTransport
{
    public function __construct(private readonly HttpFactory $http) {}

    public function send(PinnedRequest $request): StreamedResponse
    {
        try {
            $client = $this->http
                ->connectTimeout($request->connectTimeout)
                ->timeout($request->timeout)
                ->withOptions([
                    'stream' => true,
                    'allow_redirects' => false,
                    'http_errors' => false,
                    'curl' => $this->curlOptions($request),
                ]);

            if ($request->headers !== []) {
                $client = $client->withHeaders($request->headers);
            }

            $response = $client->get($request->url);
        } catch (ConnectionException $e) {
            throw $this->isTimeout($e)
                ? new FetchTimeoutException('Fetch timed out for '.$request->host.'.', 0, $e)
                : new UpstreamFetchException('Transport failure fetching '.$request->host.'.', 0, $e);
        }

        $psr = $response->toPsrResponse();

        $headers = [];
        foreach ($psr->getHeaders() as $name => $values) {
            $headers[strtolower($name)] = $values[0] ?? '';
        }

        return new StreamedResponse($psr->getStatusCode(), $headers, $psr->getBody());
    }

    /**
     * @return array<int, mixed>
     */
    private function curlOptions(PinnedRequest $request): array
    {
        $options = [
            // The pin: HOST:PORT:ADDRESS[,ADDRESS...] — connect only to these IPs.
            CURLOPT_RESOLVE => [
                sprintf('%s:%d:%s', $request->host, $request->port, implode(',', $request->pinnedIps)),
            ],
            // Abort a stalled trickle: < 1 byte/s sustained over the timeout window.
            CURLOPT_LOW_SPEED_LIMIT => 1,
            CURLOPT_LOW_SPEED_TIME => (int) ceil($request->timeout),
        ];

        // Defence in depth — redirects are followed by the guard, not curl, but
        // pin the wire protocol to exactly the scheme the guard vetted regardless.
        // That is https everywhere, except the plain-http hop of an explicitly
        // FETCH_ALLOW_HOSTS-allowlisted test-fixture host (the guard only ever
        // lets http through for those — see GuardedFetcher::vet()).
        if (defined('CURLPROTO_HTTPS')) {
            $protocol = str_starts_with(strtolower($request->url), 'http://')
                ? CURLPROTO_HTTP
                : CURLPROTO_HTTPS;
            $options[CURLOPT_PROTOCOLS] = $protocol;
            $options[CURLOPT_REDIR_PROTOCOLS] = $protocol;
        }

        return $options;
    }

    private function isTimeout(ConnectionException $e): bool
    {
        $previous = $e->getPrevious();

        if ($previous instanceof ConnectException) {
            // curl errno 28 == CURLE_OPERATION_TIMEDOUT.
            if (($previous->getHandlerContext()['errno'] ?? null) === 28) {
                return true;
            }
        }

        return str_contains(strtolower($e->getMessage()), 'timed out')
            || str_contains(strtolower($e->getMessage()), 'timeout');
    }
}
