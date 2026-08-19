<?php

namespace App\Providers;

use App\Http\Middleware\RejectAgentTokenAuth;
use App\Models\AgentToken;
use App\Services\Fetch\CurlHttpTransport;
use App\Services\Fetch\DnsResolver;
use App\Services\Fetch\HttpTransport;
use App\Services\Fetch\SystemDnsResolver;
use App\Services\Import\ConnectorRegistry;
use App\Services\Import\Connectors\GithubPatConnector;
use App\Services\Import\Connectors\GithubPublicConnector;
use App\Services\Import\Connectors\RawUrlConnector;
use App\Services\Import\Connectors\UploadConnector;
use App\Services\SystemWorkspace;
use App\Support\EmailDigest;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

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

        // The reserved demo workspace (#25) is resolved once and memoized, so
        // Document::isDemo() — hit on every shared-doc read — costs at most one
        // query per request.
        $this->app->singleton(SystemWorkspace::class);

        // The connector set (SPEC 5.1), most-specific first: GitHub blob URLs route
        // to GitHub before the catch-all raw-URL connector claims them. Upload never
        // matches a URL (it is resolved by source type), so its order is immaterial.
        //
        // The PAT reader (#23) is registered AFTER the public one, so plain match()
        // — which returns the first URL claimant — always resolves the public reader
        // for a github.com blob URL. The authenticated reader is reached only by
        // source type (the import job) or by preferredMatch() upgrading a public
        // match when the workspace has a token; never by a blind URL match.
        $this->app->singleton(ConnectorRegistry::class, fn ($app) => new ConnectorRegistry([
            $app->make(GithubPublicConnector::class),
            $app->make(GithubPatConnector::class),
            $app->make(UploadConnector::class),
            $app->make(RawUrlConnector::class),
        ]));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Sanctum's token rows ARE Kedge's Agent Tokens (SPEC §15, #131), so they
        // hydrate as the domain model: Policy discovery finds AgentTokenPolicy,
        // and `$user->currentAccessToken()` hands the Policy trait something that
        // knows how to answer "does this credential reach that workspace?".
        Sanctum::usePersonalAccessTokenModel(AgentToken::class);

        $this->configureAgentTokenRefusalPriority();
        $this->configureRateLimiting();
    }

    /**
     * Hoist the agent-token refusal to the front of the middleware priority list
     * (SPEC §15, #131).
     *
     * It is prepended to both route groups in bootstrap/app.php, but priority
     * sorting can still reorder a group. Sanctum's own provider prepends
     * `EnsureFrontendRequestsAreStateful` to that list at boot — which, left
     * alone, sorts the session/CSRF stack in FRONT of the refusal, so a
     * token-bearing request with a first-party Origin would open a database
     * session and hit CSRF (419) before being refused. Prepending here, from a
     * provider that boots after Sanctum's, puts the refusal back where the
     * security property needs it: first, before anything with a side effect.
     */
    private function configureAgentTokenRefusalPriority(): void
    {
        $this->app->make(HttpKernel::class)
            ->prependToMiddlewarePriority(RejectAgentTokenAuth::class);
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

        // Integration writes (connect + disconnect a PAT). Per authenticated user —
        // credential mutations are rare and worth bounding so a script can't churn
        // them (SPEC 13). Reads (the masked list) are free.
        RateLimiter::for('integrations', function (Request $request) {
            return Limit::perMinute(15)->by($request->user()?->id ?: $request->ip());
        });

        // Agent-token writes (mint + revoke). Per authenticated user — minting a
        // credential is a rare, deliberate act, and a script churning them is
        // never legitimate (SPEC §13). The list is a free read.
        RateLimiter::for('agent-tokens', function (Request $request) {
            return Limit::perMinute(15)->by($request->user()?->id ?: $request->ip());
        });

        // Comment writes (start a thread + reply). Per authenticated user — reads
        // stay free, and retries are additionally deduped by idempotency key.
        RateLimiter::for('comments', function (Request $request) {
            return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
        });

        // Mention autocomplete is a read, but it can disclose audience shape if
        // hammered. Keep it per authenticated user and separate from writes.
        RateLimiter::for('mentions', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // The public share read faces the open internet, so it is per-IP (SPEC
        // 10.2, 13): a leaked or brute-forced token can't be probed at speed, and
        // one visitor refreshing a doc can't be starved by another.
        RateLimiter::for('shared-read', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip());
        });

        RateLimiter::for('reviewer-magic-link', function (Request $request) {
            $email = Str::lower(trim((string) $request->input('email', '')));

            return [
                Limit::perMinute(5)->by('reviewer-email:'.EmailDigest::for($email)),
                Limit::perMinute(20)->by('reviewer-ip:'.$request->ip()),
            ];
        });

        RateLimiter::for('reviewer-verification', function (Request $request) {
            return Limit::perMinute(20)->by('reviewer-verify-ip:'.$request->ip());
        });

        // AI generation writes (SPEC §14, §13). Per authenticated user — every
        // request can queue a model call against the workspace's own Anthropic
        // key, so this is the spend bound as well as the abuse bound. Deliberately
        // tighter than the other write limiters: a runaway retry loop here costs
        // real money, and server-side dedupe already collapses honest
        // double-clicks into one run. Polling reads stay free.
        RateLimiter::for('ai', function (Request $request) {
            return Limit::perMinute((int) config('kedge.ai.rate_per_minute'))
                ->by($request->user()?->id ?: $request->ip());
        });

        // Instant demo mode is an unauthenticated, public-internet abuse surface
        // (SPEC §10.3, §13), so its limiter is the most aggressive: strictly
        // per-IP, with a burst-per-minute AND a per-day ceiling (each anonymous
        // POST spawns a guarded outbound fetch + a queued import). The numbers are
        // config so Launch can tune them without a deploy.
        RateLimiter::for('demo', function (Request $request) {
            return [
                Limit::perMinute((int) config('kedge.demo.rate_per_minute'))->by($request->ip()),
                Limit::perDay((int) config('kedge.demo.rate_per_day'))->by($request->ip()),
            ];
        });
    }
}
