<?php

namespace Tests\Support\Fetch;

use App\Services\Fetch\HttpTransport;
use App\Services\Fetch\PinnedRequest;
use App\Services\Fetch\StreamedResponse;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\StreamInterface;
use Throwable;

/**
 * A scriptable {@see HttpTransport} — the faked HTTP boundary for the SSRF suite.
 * It records every {@see PinnedRequest} it is handed (so tests can assert the
 * connection was pinned to the validated IP and the Host preserved) and replays a
 * queue of scripted outcomes: responses, redirects, or thrown transport errors.
 * Redirects and per-hop re-validation, the size cap, and the timeout path are all
 * driven from here without touching a real socket.
 */
class FakeHttpTransport implements HttpTransport
{
    /** @var list<PinnedRequest> every request handed to send(), in order */
    public array $requests = [];

    /** @var list<StreamedResponse|Throwable> queue of scripted outcomes */
    private array $queue = [];

    /**
     * @param  array<string, string>  $headers
     */
    public function respond(int $status = 200, array $headers = [], StreamInterface|string $body = ''): static
    {
        $this->queue[] = new StreamedResponse(
            $status,
            $this->lowerCaseKeys($headers),
            $body instanceof StreamInterface ? $body : Utils::streamFor($body),
        );

        return $this;
    }

    public function redirectTo(string $location, int $status = 302): static
    {
        return $this->respond($status, ['Location' => $location]);
    }

    public function fail(Throwable $e): static
    {
        $this->queue[] = $e;

        return $this;
    }

    public function send(PinnedRequest $request): StreamedResponse
    {
        $this->requests[] = $request;

        $next = array_shift($this->queue) ?? new StreamedResponse(200, [], Utils::streamFor(''));

        if ($next instanceof Throwable) {
            throw $next;
        }

        return $next;
    }

    public function lastRequest(): ?PinnedRequest
    {
        return $this->requests[array_key_last($this->requests)] ?? null;
    }

    /**
     * @param  array<string, string>  $headers
     * @return array<string, string>
     */
    private function lowerCaseKeys(array $headers): array
    {
        $lowered = [];
        foreach ($headers as $name => $value) {
            $lowered[strtolower($name)] = $value;
        }

        return $lowered;
    }
}
