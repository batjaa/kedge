<?php

namespace App\Services\Fetch;

/**
 * One HTTP request that {@see GuardedFetcher} has already vetted: the scheme is
 * https, the host has been resolved, and every resolved address passed
 * {@see AddressGuard}. The transport MUST connect only to {@see $pinnedIps} while
 * presenting {@see $host} for the Host header, SNI, and certificate validation —
 * that pinning is what closes the DNS-rebinding window.
 */
class PinnedRequest
{
    /**
     * @param  string  $url  Absolute https URL for this single hop (no redirect following).
     * @param  string  $host  Hostname (or IP literal) to preserve for Host/SNI/cert.
     * @param  int  $port  Resolved port (443 unless the URL overrides it).
     * @param  list<string>  $pinnedIps  Validated addresses the connection may use — and only these.
     * @param  float  $timeout  Total transfer timeout, seconds.
     * @param  float  $connectTimeout  Connection-establishment timeout, seconds.
     */
    public function __construct(
        public readonly string $url,
        public readonly string $host,
        public readonly int $port,
        public readonly array $pinnedIps,
        public readonly float $timeout,
        public readonly float $connectTimeout,
    ) {}
}
