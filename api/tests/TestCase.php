<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Send subsequent requests as the first-party web app (dev two-port
     * topology): an Origin inside SANCTUM_STATEFUL_DOMAINS, so Sanctum
     * treats the request as stateful (SPA cookie auth).
     */
    protected function fromWebApp(): static
    {
        return $this->withHeader('Origin', 'http://localhost:3000');
    }
}
