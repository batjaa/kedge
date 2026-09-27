<?php

namespace Tests;

use App\Models\User;
use App\Services\RegistrationService;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Notification;

abstract class TestCase extends BaseTestCase
{
    /** Create an activated workspace owner for resource tests. Auth tests use the real signup flow. */
    protected function registerVerifiedUser(...$attributes): User
    {
        $notifications = Notification::getFacadeRoot();
        Notification::fake();
        try {
            $user = app(RegistrationService::class)->register(...$attributes);
        } finally {
            Notification::swap($notifications);
        }
        $user->markEmailAsVerified();

        return $user;
    }

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
