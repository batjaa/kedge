<?php

namespace App\Services\Fetch;

/**
 * The production {@see DnsResolver}: a real system lookup of both A (IPv4) and
 * AAAA (IPv6) records. Its result is what {@see GuardedFetcher} validates and then
 * pins the connection to, so nothing here re-resolves later.
 */
class SystemDnsResolver implements DnsResolver
{
    public function resolve(string $host): array
    {
        $addresses = [];

        // IPv4 (A records).
        $ipv4 = @gethostbynamel($host);
        if ($ipv4 !== false) {
            $addresses = $ipv4;
        }

        // IPv6 (AAAA records).
        $aaaa = @dns_get_record($host, DNS_AAAA);
        if ($aaaa !== false) {
            foreach ($aaaa as $record) {
                if (isset($record['ipv6'])) {
                    $addresses[] = $record['ipv6'];
                }
            }
        }

        return array_values(array_unique($addresses));
    }
}
