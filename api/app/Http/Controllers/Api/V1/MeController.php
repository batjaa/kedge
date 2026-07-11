<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\CurrentUserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeController extends Controller
{
    /**
     * Who am I: the authenticated user and their personal workspace.
     *
     * Identity endpoint, not a resource — auth:sanctum suffices; Policies
     * arrive with the first real resource routes (M1, SPEC 13).
     */
    public function __invoke(Request $request): JsonResponse
    {
        // Explicit 200: resource responses infer 201 from a freshly
        // created model, but GET /me always answers 200.
        return CurrentUserResource::make($request->user())
            ->response($request)
            ->setStatusCode(200);
    }
}
