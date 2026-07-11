<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * External behavior of POST /logout: the server-side session is actually
 * destroyed — the old session cookie stops authenticating.
 *
 * These tests replay the real session cookie (withCredentials, like the
 * browser's fetch credentials: 'include') and flush in-process guard
 * memoization between requests, so authentication genuinely comes from
 * the cookie on every request.
 */
class LogoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_logout_invalidates_the_session(): void
    {
        $register = $this->postJson('/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);
        $register->assertCreated();

        $sessionId = $register->getCookie(config('session.cookie'))->getValue();
        $this->withCredentials()->withCookie(config('session.cookie'), $sessionId);

        // The session cookie authenticates the stateful /api/v1 surface.
        $this->forgetGuards();
        $this->fromWebApp()->getJson('/api/v1/me')->assertOk();

        $this->forgetGuards();
        $this->postJson('/logout')->assertNoContent();
        $this->assertGuest('web');

        // The same cookie must no longer authenticate: the session was
        // destroyed server-side, not just forgotten by the client.
        $this->forgetGuards();
        $this->fromWebApp()->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertDatabaseMissing('sessions', ['id' => $sessionId]);
    }

    public function test_guests_cannot_logout(): void
    {
        $this->postJson('/logout')->assertUnauthorized();
    }

    /**
     * Drop guard memoization between in-process requests — over real HTTP
     * every request starts with fresh guards.
     */
    private function forgetGuards(): void
    {
        $this->app['auth']->forgetGuards();
    }
}
