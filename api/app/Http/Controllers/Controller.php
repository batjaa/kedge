<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

/**
 * Base controller. Carries AuthorizesRequests so every resource controller can
 * `$this->authorize()` against a Policy (SPEC 13) — the house rule is that
 * authorization is a Policy call, never an inline ownership check.
 */
abstract class Controller
{
    use AuthorizesRequests;
}
