<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\V1\CurrentUserResource;
use App\Services\RegistrationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

class RegisteredUserController extends Controller
{
    /**
     * Register a new account and start its session.
     */
    public function store(RegisterRequest $request, RegistrationService $registration): JsonResponse
    {
        $user = $registration->register(
            name: $request->validated('name'),
            email: $request->normalizedEmail(),
            password: $request->validated('password'),
            ip: $request->ip(),
        );

        Auth::guard('web')->login($user, remember: true);

        $request->session()->regenerate();

        return CurrentUserResource::make($user)
            ->response($request)
            ->setStatusCode(201);
    }
}
