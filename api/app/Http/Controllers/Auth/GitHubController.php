<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\GitHubAuthService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

/**
 * One-click GitHub sign-in (ticket #6). The redirect and callback are top-level
 * browser navigations to this API's own origin, so the stateful (session-based)
 * Socialite driver is used deliberately: the API session cookie rides both legs
 * (SameSite=Lax permits it on the cross-site callback GET), which keeps
 * Socialite's CSRF `state` validation — stateless mode would discard it for no
 * gain. A successful callback establishes exactly the Sanctum SPA session the
 * email/password path creates, then bounces the browser to the web app's shell.
 *
 * Both routes 404 when OAuth is unconfigured (guarded here, single source of
 * truth in GitHubAuthService) — unconfigured features hide, never break.
 */
class GitHubController extends Controller
{
    public function __construct(
        private readonly GitHubAuthService $github,
    ) {}

    /**
     * Send the visitor to github.com to authorize.
     */
    public function redirect(): RedirectResponse
    {
        abort_unless($this->github->isConfigured(), 404);

        return Socialite::driver('github')->scopes(['user:email'])->redirect();
    }

    /**
     * Handle the OAuth callback: create-or-link, start the session, and return
     * the browser to the web app. Any failure lands on the sign-in page with a
     * friendly flag rather than a raw error — auth never dead-ends (SPEC US9).
     */
    public function callback(Request $request): RedirectResponse
    {
        abort_unless($this->github->isConfigured(), 404);

        try {
            $githubUser = Socialite::driver('github')->user();
        } catch (Throwable) {
            // Bad/expired code, denied consent, mismatched state, GitHub down.
            return $this->backToSignIn('github_failed');
        }

        $verifiedEmail = $githubUser->getEmail();

        // No verified primary email → we can neither safely link nor create.
        // Never fall back to the unverified profile email (takeover vector).
        if (blank($verifiedEmail)) {
            return $this->backToSignIn('github_no_verified_email');
        }

        $user = $this->github->resolve($githubUser, $verifiedEmail, $request->ip());

        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return redirect()->away(config('kedge.frontend_url').'/');
    }

    /**
     * Bounce back to the web app's sign-in page with a machine-readable reason.
     */
    private function backToSignIn(string $error): RedirectResponse
    {
        return redirect()->away(config('kedge.frontend_url').'/signin?error='.$error);
    }
}
