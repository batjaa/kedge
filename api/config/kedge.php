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

    /*
    |--------------------------------------------------------------------------
    | Frontend URL
    |--------------------------------------------------------------------------
    |
    | Where the API sends the browser after an out-of-band top-level redirect —
    | today only the GitHub OAuth callback (ticket #6), which lands the user on
    | the web app's authenticated shell. Env-driven so every topology (dev
    | two-port, SaaS split-domain, self-host single-origin) is a config change,
    | never a code change (SPEC 4).
    |
    */

    'frontend_url' => rtrim((string) env('FRONTEND_URL', 'http://localhost:3000'), '/'),

];
