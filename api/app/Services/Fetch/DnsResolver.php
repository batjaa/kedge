<?php

namespace App\Services\Fetch;

/**
 * Resolves a hostname to its IP addresses. Injected into {@see GuardedFetcher} so
 * the whole SSRF surface — private-range blocking and the resolve-then-pin
 * guarantee — is testable without real DNS: a fake resolver drives the guard's
 * decisions directly, including the rebinding scenario (the fetcher must resolve
 * exactly once per hop and connect to that result).
 */
interface DnsResolver
{
    /**
     * @return list<string> Resolved IPv4/IPv6 addresses, in no guaranteed order.
     *                      Empty when the host does not resolve.
     */
    public function resolve(string $host): array;
}
