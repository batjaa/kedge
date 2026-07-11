<?php

use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\SessionController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
|--------------------------------------------------------------------------
| Session / auth routes (Sanctum SPA cookie flow)
|--------------------------------------------------------------------------
|
| These live at the framework root by Sanctum convention — alongside the
| GET /sanctum/csrf-cookie route the package registers. Everything
| resource-shaped lives under /api/v1 (routes/api.php). All auth
| endpoints are rate-limited (SPEC 13).
|
*/

Route::middleware('throttle:auth')->group(function () {
    Route::post('/register', [RegisteredUserController::class, 'store'])->name('register');
    Route::post('/login', [SessionController::class, 'store'])->name('login');

    Route::post('/logout', [SessionController::class, 'destroy'])
        ->middleware('auth:sanctum')
        ->name('logout');
});
