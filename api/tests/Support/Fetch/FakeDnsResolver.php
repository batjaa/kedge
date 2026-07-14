<?php

namespace Tests\Support\Fetch;

use App\Services\Fetch\DnsResolver;

/**
 * A scriptable {@see DnsResolver} for the SSRF suite. Lets a test decide exactly
 * what a hostname resolves to — including handing back different addresses on
 * successive calls to model a DNS-rebinding attacker — and records how many times
 * each host was resolved so the pin ("resolve exactly once, connect to that") is
 * assertable.
 */
class FakeDnsResolver implements DnsResolver
{
    /** @var array<string, list<list<string>>> host => queue of scripted results */
    private array $scripted = [];

    /** @var array<string, int> host => number of resolve() calls */
    public array $calls = [];

    /**
     * Append a scripted result for $host. Successive calls consume successive
     * results; the final one is sticky (returned for every later call).
     *
     * @param  list<string>  $ips
     */
    public function set(string $host, array $ips): static
    {
        $this->scripted[$host][] = $ips;

        return $this;
    }

    public function resolve(string $host): array
    {
        $this->calls[$host] = ($this->calls[$host] ?? 0) + 1;

        $queue = $this->scripted[$host] ?? [[]];

        // Consume the next scripted result, but keep the last one sticky.
        if (count($queue) > 1) {
            return array_shift($this->scripted[$host]);
        }

        return $queue[0];
    }

    public function callCount(string $host): int
    {
        return $this->calls[$host] ?? 0;
    }
}
