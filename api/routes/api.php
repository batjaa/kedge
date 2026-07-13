<?php

use App\Http\Controllers\Api\V1\ConfigController;
use App\Http\Controllers\Api\V1\MeController;
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

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', MeController::class)->name('api.v1.me');
    });
});
