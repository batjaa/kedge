<?php

use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\GitHubController;
use App\Http\Controllers\Auth\PasswordResetController;
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

Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
    ->middleware('throttle:30,1')->name('verification.verify');
Route::post('/email/verification-notification', [EmailVerificationController::class, 'resend'])
    ->middleware(['auth:sanctum', 'throttle:1,1'])->name('verification.send');

Route::middleware('throttle:auth')->group(function () {
    Route::post('/forgot-password', [PasswordResetController::class, 'store'])->name('password.email');
    Route::post('/reset-password', [PasswordResetController::class, 'update'])->name('password.update');
    Route::post('/register', [RegisteredUserController::class, 'store'])->name('register');
    Route::post('/login', [SessionController::class, 'store'])->name('login');

    Route::post('/logout', [SessionController::class, 'destroy'])
        ->middleware('auth:sanctum')
        ->name('logout');

    // GitHub OAuth (ticket #6): top-level browser navigations, not JSON — they
    // 302 to github.com and back. Registered unconditionally but 404 in the
    // controller when OAuth is unconfigured, so the feature toggles at request
    // time (single source of truth: GitHubAuthService::isConfigured). Same
    // per-IP `auth` limiter as the other auth endpoints (SPEC 13).
    Route::get('/auth/github/redirect', [GitHubController::class, 'redirect'])->name('auth.github.redirect');
    Route::get('/auth/github/callback', [GitHubController::class, 'callback'])->name('auth.github.callback');
});
