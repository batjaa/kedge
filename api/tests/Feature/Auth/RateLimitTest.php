<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * All auth endpoints are rate-limited (SPEC 13): the shared per-IP "auth"
 * limiter allows 10 requests per minute, the 11th trips 429.
 */
class RateLimitTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_rate_limit_trips_after_ten_attempts(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/login', [
                'email' => 'ada@example.com',
                'password' => 'wrong-password-'.$i,
            ])->assertUnprocessable();
        }

        $this->postJson('/login', [
            'email' => 'ada@example.com',
            'password' => 'wrong-password-11',
        ])
            ->assertTooManyRequests()
            ->assertHeader('Retry-After');
    }

    public function test_register_rate_limit_trips_after_ten_attempts(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/register', [])->assertUnprocessable();
        }

        $this->postJson('/register', [])->assertTooManyRequests();
    }
}
