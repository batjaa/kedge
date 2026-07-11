<?php

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
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', MeController::class)->name('api.v1.me');
    });
});
