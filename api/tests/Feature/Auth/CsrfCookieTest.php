<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The Sanctum SPA handshake starts here: the web app fetches the CSRF
 * cookie before any credentialed POST.
 */
class CsrfCookieTest extends TestCase
{
    use RefreshDatabase;

    public function test_csrf_cookie_endpoint_issues_the_xsrf_token_cookie(): void
    {
        $response = $this->fromWebApp()->get('/sanctum/csrf-cookie');

        $response
            ->assertNoContent()
            ->assertCookie('XSRF-TOKEN')
            ->assertCookie(config('session.cookie'));
    }
}
