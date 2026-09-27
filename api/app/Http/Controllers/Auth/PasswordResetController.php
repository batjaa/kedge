<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\AccountPasswordService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

class PasswordResetController extends Controller
{
    public function store(Request $request, AccountPasswordService $passwords): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:255']]);
        $passwords->sendLink($data['email']);

        // Same response for absent accounts and broker-throttled requests.
        return response()->json(['message' => 'If this email has a password account, a reset link has been sent.']);
    }

    public function update(Request $request, AccountPasswordService $passwords): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'confirmed', PasswordRule::defaults()],
        ]);
        $status = $passwords->reset($data);

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'token' => 'This password reset link is invalid or expired. Request a new link.',
            ]);
        }

        return response()->json(['message' => 'Your password has been reset. Sign in with your new password.']);
    }
}
