<?php

namespace App\Providers;

use App\Services\Fetch\CurlHttpTransport;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\Fetch\SystemDnsResolver;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\Connectors\GithubPublicConnector;
use App\Services\Import\Connectors\RawUrlConnector;
use App\Services\Import\Connectors\UploadConnector;
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

        // The connector set (SPEC 5.1), most-specific first: GitHub blob URLs route
        // to GitHub before the catch-all raw-URL connector claims them. Upload never
        // matches a URL (it is resolved by source type), so its order is immaterial.
        $this->app->singleton(ConnectorRegistry::class, fn ($app) => new ConnectorRegistry([
            $app->make(GithubPublicConnector::class),
            $app->make(UploadConnector::class),
            $app->make(RawUrlConnector::class),
        ]));
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

        // Import writes (paste-a-URL + retry) are rate-limited from day one
        // (SPEC 13). Per authenticated user — each import spawns a guarded
        // outbound fetch, so this bounds how fast one account can drive the queue.
        RateLimiter::for('imports', function (Request $request) {
            return Limit::perMinute(20)->by($request->user()?->id ?: $request->ip());
        });

        // Share-link writes (create + revoke). Per authenticated user — cheap
        // mutations, but still bounded so a script can't churn links (SPEC 13).
        RateLimiter::for('shares', function (Request $request) {
            return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
        });

        // The public share read faces the open internet, so it is per-IP (SPEC
        // 10.2, 13): a leaked or brute-forced token can't be probed at speed, and
        // one visitor refreshing a doc can't be starved by another.
        RateLimiter::for('shared-read', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip());
        });
    }
}
