<?php

namespace Tests\Unit\Fetch;

use App\Services\Fetch\AddressGuard;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Range-by-range coverage of the address deny-list — the core decision behind
 * every private/reserved block (SPEC 13, issue #16). Pure and DB-free.
 */
class AddressGuardTest extends TestCase
{
    private AddressGuard $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->guard = new AddressGuard;
    }

    #[DataProvider('blockedAddresses')]
    public function test_blocks_private_and_reserved_addresses(string $ip): void
    {
        $this->assertFalse($this->guard->isAllowed($ip), "{$ip} should be blocked");
    }

    #[DataProvider('allowedAddresses')]
    public function test_allows_public_addresses(string $ip): void
    {
        $this->assertTrue($this->guard->isAllowed($ip), "{$ip} should be allowed");
    }

    /**
     * @return array<string, array{string}>
     */
    public static function blockedAddresses(): array
    {
        return [
            // IPv4 private (RFC1918)
            '10/8 private' => ['10.0.0.1'],
            '172.16/12 private' => ['172.16.5.4'],
            '172.31 edge of /12' => ['172.31.255.255'],
            '192.168/16 private' => ['192.168.1.1'],
            // IPv4 loopback / link-local / metadata
            'loopback' => ['127.0.0.1'],
            'loopback edge' => ['127.255.255.255'],
            'link-local' => ['169.254.1.1'],
            'cloud metadata endpoint' => ['169.254.169.254'],
            // IPv4 other reserved
            '0.0.0.0/8' => ['0.0.0.0'],
            'this-host 0.x' => ['0.1.2.3'],
            'carrier-grade NAT' => ['100.64.1.1'],
            'benchmarking' => ['198.18.0.1'],
            'multicast' => ['224.0.0.1'],
            'reserved future' => ['240.0.0.1'],
            'broadcast' => ['255.255.255.255'],
            'TEST-NET-1' => ['192.0.2.1'],
            // IPv6 loopback / unspecified
            'v6 loopback' => ['::1'],
            'v6 unspecified' => ['::'],
            // IPv6 ULA / link-local
            'v6 ULA fc00::/7' => ['fc00::1'],
            'v6 ULA fd00' => ['fd12:3456:789a::1'],
            'v6 link-local fe80::/10' => ['fe80::1'],
            'v6 multicast' => ['ff02::1'],
            // IPv4-mapped IPv6 must be judged by the embedded IPv4
            'v4-mapped loopback' => ['::ffff:127.0.0.1'],
            'v4-mapped metadata' => ['::ffff:169.254.169.254'],
            'v4-mapped private' => ['::ffff:10.0.0.1'],
            // Not an IP at all
            'garbage' => ['not-an-ip'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function allowedAddresses(): array
    {
        return [
            'public v4 (example.com)' => ['93.184.216.34'],
            'public v4 (dns)' => ['8.8.8.8'],
            'public v4 (cloudflare)' => ['1.1.1.1'],
            'just outside 172.16/12 low' => ['172.15.255.255'],
            'just outside 172.16/12 high' => ['172.32.0.0'],
            'just outside 100.64/10' => ['100.128.0.1'],
            'public v6' => ['2606:4700:4700::1111'],
            'public v6 google' => ['2001:4860:4860::8888'],
            'v4-mapped public' => ['::ffff:93.184.216.34'],
        ];
    }
}
