<?php

use App\Http\Middleware\EnsureDemoModeEnabled;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum SPA cookie mode: first-party frontend requests (Origin /
        // Referer in SANCTUM_STATEFUL_DOMAINS) authenticate api routes via
        // the session cookie instead of tokens (SPEC 4).
        $middleware->statefulApi();

        // Pasted/uploaded document content is stored byte-for-byte (#22): trimming
        // its leading/trailing whitespace would alter the rendered document and its
        // content_hash. Exempt it from the global TrimStrings middleware.
        $middleware->trimStrings(except: ['content']);

        // Instant demo mode is SaaS-only (SPEC §10.3, #25): this alias 404s the
        // demo + claim routes on a self-hosted instance, per request.
        $middleware->alias(['demo.enabled' => EnsureDemoModeEnabled::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The API is a headless JSON backend: versioned routes and the
        // root-level session routes always answer JSON — a 401/419 must
        // reach the web app as JSON, never as a redirect (SPEC 4).
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'register', 'login', 'logout', 'sanctum/*')
                || $request->expectsJson(),
        );
    })->create();
