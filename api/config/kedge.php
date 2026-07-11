<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Self-hosted edition
    |--------------------------------------------------------------------------
    |
    | True when Kedge runs as a self-hosted deployment rather than the managed
    | SaaS. Plumbed from M0 so later modules (demo mode lands in M1) can branch
    | on edition without retrofitting config. Nothing hides behind it yet.
    |
    */

    'self_hosted' => (bool) env('SELF_HOSTED', false),

];
