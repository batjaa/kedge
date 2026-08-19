<?php

use App\Providers\AppServiceProvider;
use App\Providers\FakeAiServiceProvider;

return [
    AppServiceProvider::class,
    // Registered unconditionally, active only under the double-gated
    // `kedge.ai.fake` (E2E / testing) — the Nightwatch idiom: it ships, and it
    // is a no-op everywhere it is not explicitly switched on.
    FakeAiServiceProvider::class,
];
