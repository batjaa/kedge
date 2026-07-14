<?php

namespace App\Services\Fetch;

/**
 * Decides whether a single IP address is safe to connect to. Pure and
 * dependency-free: it is handed already-resolved addresses by
 * {@see GuardedFetcher}, so it never touches DNS or the network and is exhaustively
 * unit-testable range by range.
 *
 * Deny-list, not allow-list: anything in a private, loopback, link-local,
 * carrier-grade-NAT, multicast, documentation, or otherwise reserved block is
 * refused; everything else (global unicast) is permitted. IPv4-mapped IPv6
 * addresses are unwrapped and judged by their embedded IPv4 so
 * `::ffff:169.254.169.254` cannot smuggle the cloud-metadata endpoint past the
 * IPv4 checks.
 */
class AddressGuard
{
    /**
     * Reserved / non-public IPv4 blocks, as [network, prefix-bits].
     *
     * @var list<array{string, int}>
     */
    private const IPV4_BLOCKS = [
        ['0.0.0.0', 8],        // "this" network / unspecified
        ['10.0.0.0', 8],       // RFC1918 private
        ['100.64.0.0', 10],    // RFC6598 carrier-grade NAT
        ['127.0.0.0', 8],      // loopback
        ['169.254.0.0', 16],   // link-local — includes 169.254.169.254 cloud metadata
        ['172.16.0.0', 12],    // RFC1918 private
        ['192.0.0.0', 24],     // IETF protocol assignments
        ['192.0.2.0', 24],     // TEST-NET-1 (documentation)
        ['192.88.99.0', 24],   // 6to4 relay anycast (deprecated)
        ['192.168.0.0', 16],   // RFC1918 private
        ['198.18.0.0', 15],    // benchmarking
        ['198.51.100.0', 24],  // TEST-NET-2 (documentation)
        ['203.0.113.0', 24],   // TEST-NET-3 (documentation)
        ['224.0.0.0', 4],      // multicast
        ['240.0.0.0', 4],      // reserved / future use (includes 255.255.255.255)
    ];

    /**
     * Reserved / non-public IPv6 blocks, as [network, prefix-bits]. IPv4-mapped
     * (::ffff:0:0/96) is handled separately by unwrapping to IPv4.
     *
     * @var list<array{string, int}>
     */
    private const IPV6_BLOCKS = [
        ['::', 128],           // unspecified
        ['::1', 128],          // loopback
        ['64:ff9b::', 96],     // NAT64 well-known prefix (embeds IPv4)
        ['100::', 64],         // discard-only
        ['2001:db8::', 32],    // documentation
        ['fc00::', 7],         // unique local address (ULA)
        ['fe80::', 10],        // link-local
        ['ff00::', 8],         // multicast
    ];

    /**
     * True when the address is a global, routable unicast address that the
     * fetcher may connect to.
     */
    public function isAllowed(string $ip): bool
    {
        $binary = @inet_pton($ip);

        if ($binary === false) {
            return false; // not a valid textual IP → never connectable
        }

        // IPv4-mapped IPv6 (::ffff:a.b.c.d): judge by the embedded IPv4.
        if (strlen($binary) === 16 && str_starts_with($binary, "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff")) {
            return $this->isAllowed(inet_ntop(substr($binary, 12)));
        }

        $blocks = strlen($binary) === 4 ? self::IPV4_BLOCKS : self::IPV6_BLOCKS;

        foreach ($blocks as [$network, $prefix]) {
            if ($this->inRange($binary, $network, $prefix)) {
                return false;
            }
        }

        return true;
    }

    /**
     * True when $binary (packed inet_pton form) falls inside network/prefix.
     * Compares the leading whole bytes, then the partial byte under a mask, so it
     * works identically for 4-byte and 16-byte addresses.
     */
    private function inRange(string $binary, string $network, int $prefix): bool
    {
        $networkBinary = inet_pton($network);

        if ($networkBinary === false || strlen($networkBinary) !== strlen($binary)) {
            return false;
        }

        $wholeBytes = intdiv($prefix, 8);
        $remainingBits = $prefix % 8;

        if ($wholeBytes > 0 && strncmp($binary, $networkBinary, $wholeBytes) !== 0) {
            return false;
        }

        if ($remainingBits === 0) {
            return true;
        }

        $mask = 0xFF << (8 - $remainingBits) & 0xFF;

        return (ord($binary[$wholeBytes]) & $mask) === (ord($networkBinary[$wholeBytes]) & $mask);
    }
}
