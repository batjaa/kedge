<?php

namespace Tests\Feature;

use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    /**
     * The health endpoint is the deploy smoke-test hook (SPEC 20.1) and the
     * first exercise of the API HTTP feature-test seam every later module
     * inherits: hit the app over HTTP, assert external behavior only.
     */
    public function test_health_endpoint_returns_ok(): void
    {
        $response = $this->get('/up');

        $response->assertNotFound(); // CI red-path check: deliberately wrong, reverted immediately.
    }
}
