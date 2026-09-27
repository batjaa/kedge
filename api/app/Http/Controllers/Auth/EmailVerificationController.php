<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller
{
    public function verify(Request $request, string $id, string $hash): RedirectResponse
    {
        // The signed link proves mailbox possession, including on another device.
        // It confirms the account without starting a session for the link recipient.
        $user = $request->hasValidSignature() ? User::find($id) : null;
        if (! $user || ! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return redirect(config('kedge.frontend_url').'/verify-email?status=invalid');
        }

        if (! $user->hasVerifiedEmail() && $user->markEmailAsVerified()) {
            event(new Verified($user));
        }

        return redirect(config('kedge.frontend_url').'/verify-email?status=verified');
    }

    public function resend(Request $request): JsonResponse
    {
        if (! $request->user()->hasVerifiedEmail()) {
            $request->user()->sendEmailVerificationNotification();
        }

        return response()->json(['message' => 'Confirmation email requested.']);
    }
}
