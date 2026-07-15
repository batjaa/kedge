<?php

use App\Http\Controllers\Api\V1\ClaimDocumentController;
use App\Http\Controllers\Api\V1\ConfigController;
use App\Http\Controllers\Api\V1\DemoDocumentController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\IntegrationController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\ShareController;
use App\Http\Controllers\Api\V1\SharedDocumentController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes — versioned under /api/v1 from day one (SPEC 4)
|--------------------------------------------------------------------------
|
| Changes are additive-only: the web app and the API deploy independently,
| so /v1 is a contract, never a moving target. Resource routes gain
| Policies as they appear (SPEC 13); /me is identity, not a resource.
|
*/

Route::prefix('v1')->group(function () {
    // Public runtime capabilities the web app reads to decide what to render
    // (e.g. the GitHub sign-in button). No auth; its own generous per-IP
    // limiter so a page-load config read never eats the login budget.
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('/config', ConfigController::class)->name('api.v1.config');
    });

    // Public read-only share surface (SPEC 10.2). No auth — the token is the
    // capability. Per-IP limiter because it faces the open internet; a valid
    // token grants exactly this doc and nothing else (no session, no id path).
    Route::middleware('throttle:shared-read')->group(function () {
        Route::get('/shared/{token}', [SharedDocumentController::class, 'show'])
            ->name('api.v1.shared.show');
    });

    // ---- Instant demo mode (SPEC 10.3, #25) — SaaS-only -------------------
    //
    // The PLG wedge: an anonymous stranger pastes a public URL and gets the
    // rendered doc with zero signup. Unauthenticated by design, so it is the
    // most aggressively bounded surface in the app — `demo.enabled` 404s the
    // whole thing on a self-hosted instance, and `throttle:demo` caps it hard
    // per IP (public connectors only + SSRF guarding live in the controller and
    // the shared fetcher). The claim endpoint (authenticated) lives in the
    // guarded group below, edition-gated the same way.
    Route::middleware(['demo.enabled', 'throttle:demo'])->group(function () {
        Route::post('/demo/documents', [DemoDocumentController::class, 'store'])
            ->name('api.v1.demo.documents.store');
    });

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', MeController::class)->name('api.v1.me');

        // Import & render (SPEC 5.3). Reads poll freely; the write endpoints
        // (import, retry) share a per-user limiter so a runaway paste loop or a
        // retry hammer can't flood the fetch queue (SPEC 13).
        Route::get('/documents/{document}', [DocumentController::class, 'show'])
            ->name('api.v1.documents.show');

        Route::middleware('throttle:imports')->group(function () {
            Route::post('/documents', [DocumentController::class, 'store'])
                ->name('api.v1.documents.store');
            Route::post('/documents/{document}/retry', [DocumentController::class, 'retry'])
                ->name('api.v1.documents.retry');

            // Claim a demo doc into my workspace (SPEC 10.3, #25). Edition-gated
            // like the anonymous demo import: absent entirely when self-hosted.
            Route::post('/documents/{document}/claim', ClaimDocumentController::class)
                ->middleware('demo.enabled')
                ->name('api.v1.documents.claim');
        });

        // Share-link management (SPEC 10.2), all behind SharePolicy. Listing is a
        // free read; create/revoke share a per-user limiter (share writes spawn
        // no outbound fetch but are still mutations worth bounding).
        Route::get('/documents/{document}/shares', [ShareController::class, 'index'])
            ->name('api.v1.documents.shares.index');

        Route::middleware('throttle:shares')->group(function () {
            Route::post('/documents/{document}/shares', [ShareController::class, 'store'])
                ->name('api.v1.documents.shares.store');
            Route::delete('/documents/{document}/shares/{share}', [ShareController::class, 'destroy'])
                ->scopeBindings()
                ->name('api.v1.documents.shares.destroy');
        });

        // Integration credentials (SPEC §16, §13), all behind IntegrationPolicy.
        // The masked list is a free read; connect/disconnect share a per-user
        // limiter (credential mutations are rare and worth bounding). Credentials
        // are encrypted at rest and never returned — see IntegrationResource.
        Route::get('/integrations', [IntegrationController::class, 'index'])
            ->name('api.v1.integrations.index');

        Route::middleware('throttle:integrations')->group(function () {
            Route::post('/integrations', [IntegrationController::class, 'store'])
                ->name('api.v1.integrations.store');
            Route::delete('/integrations/{integration}', [IntegrationController::class, 'destroy'])
                ->name('api.v1.integrations.destroy');
        });
    });
});
