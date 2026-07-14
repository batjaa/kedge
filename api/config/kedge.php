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

    /*
    |--------------------------------------------------------------------------
    | Guarded outbound fetching (SSRF guard)
    |--------------------------------------------------------------------------
    |
    | Caps for the one SSRF-guarded fetcher every outbound request flows through
    | (App\Services\Fetch\GuardedFetcher — SPEC 13). Imports, image re-hosting,
    | and demo-mode fetches all obey these unless a caller overrides the size or
    | timeout per call (uploads and images differ). The scheme allowlist is
    | https-only; keep it that way — it is the first line of the guard.
    |
    */

    'fetch' => [
        // Hard ceiling on any response body, in bytes (default 10 MiB). Enforced
        // mid-stream — the transfer aborts rather than buffering past the cap.
        'max_bytes' => (int) env('FETCH_MAX_BYTES', 10 * 1024 * 1024),

        // Total transfer timeout and connection-establishment timeout, in seconds.
        'timeout' => (float) env('FETCH_TIMEOUT', 15),
        'connect_timeout' => (float) env('FETCH_CONNECT_TIMEOUT', 5),

        // Manual redirect hop cap — each hop is re-validated and re-pinned.
        'max_redirects' => (int) env('FETCH_MAX_REDIRECTS', 5),

        // Scheme allowlist. https-only by acceptance criteria (issue #16).
        'allowed_schemes' => ['https'],
    ],

    /*
    |--------------------------------------------------------------------------
    | Text projection service (anchor substrate)
    |--------------------------------------------------------------------------
    |
    | The web layer owns the plain-text projection (SPEC §5.4): the import job
    | POSTs normalized content to the web app's internal /internal/projection
    | endpoint and stores the returned plain_text + projection_version on the
    | version. That endpoint is internal — never publicly reachable — and guards
    | itself with a shared secret, so both sides must carry the SAME
    | PROJECTION_SHARED_SECRET.
    |
    | The URL is env-driven for every topology (dev two-port, SaaS split-domain,
    | self-host single-origin). In dev the secret defaults to a well-known value
    | the web app also defaults to, so imports project with no extra config; in
    | production it MUST be set on both sides.
    |
    */

    'projection' => [
        'url' => rtrim((string) env('PROJECTION_URL', 'http://localhost:3000'), '/'),
        'secret' => env('PROJECTION_SHARED_SECRET', 'dev-projection-secret'),
        'timeout' => (float) env('PROJECTION_TIMEOUT', 10),
    ],

];
