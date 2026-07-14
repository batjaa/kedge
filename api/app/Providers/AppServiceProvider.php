<?php

namespace App\Providers;

use App\Services\Fetch\CurlHttpTransport;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\Fetch\SystemDnsResolver;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // The SSRF guard's two swappable seams (SPEC 13): real DNS + curl pinning
        // in production, faked in tests to drive private-range, rebinding-pin,
        // redirect, size, and timeout behaviour. GuardedFetcher itself and
        // AddressGuard are plain autowired singletons — no binding needed.
        $this->app->bind(DnsResolver::class, SystemDnsResolver::class);
        $this->app->bind(HttpTransport::class, CurlHttpTransport::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();
    }

    /**
     * All auth endpoints are rate-limited (SPEC 13). One shared per-IP
     * bucket across register/login/logout keeps credential stuffing and
     * enumeration bounded without hurting real users.
     */
    private function configureRateLimiting(): void
    {
        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(10)->by($request->ip());
        });
    }
}
