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

        // TEST-ONLY escape hatch (#26, reused by #39): hostnames the guard exempts
        // from the private-address rejection (plain http is also permitted for
        // them), so the Playwright journeys can import a fixture document served
        // on loopback. Comma-separated, EMPTY by default — the guard behaves
        // exactly as specced unless an operator explicitly sets it. It must never
        // be set in production or any real deployment: a listed host is a tunnel
        // through the SSRF guard. Redirects OFF an allowlisted host still run the
        // full guard.
        'allow_hosts' => array_values(array_filter(array_map(
            fn (string $host): string => strtolower(trim($host)),
            explode(',', (string) env('FETCH_ALLOW_HOSTS', '')),
        ), fn (string $host): bool => $host !== '')),
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
        'current_version' => (string) env('PROJECTION_VERSION', '2'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Manual re-sync and re-anchoring
    |--------------------------------------------------------------------------
    |
    | Manual re-sync is a rollout-gated M3 surface. Re-anchoring calls the web
    | app's /internal/reanchor endpoint, guarded with the same shared-secret
    | pattern as projection. Defaults mirror projection for local two-port dev.
    |
    */

    'resync' => [
        'enabled' => (bool) env('RESYNC_ENABLED', true),
    ],

    'reanchor' => [
        'url' => rtrim((string) env('REANCHOR_URL', env('PROJECTION_URL', 'http://localhost:3000')), '/'),
        'secret' => env('REANCHOR_SHARED_SECRET', env('PROJECTION_SHARED_SECRET', 'dev-projection-secret')),
        'timeout' => (float) env('REANCHOR_TIMEOUT', 10),
    ],

    /*
    |--------------------------------------------------------------------------
    | Re-hosted media (SPEC 5.2)
    |--------------------------------------------------------------------------
    |
    | Imported documents must not depend on their origin's servers, so every
    | referenced image is fetched through the SSRF guard and re-hosted here
    | (App\Services\Import\Normalization\ImageReHoster). `disk` is any Laravel
    | filesystem disk — the `public` disk (served via the /storage symlink the
    | entrypoint creates) in dev and self-host, an S3/R2 disk on the SaaS. Keep
    | it env-driven so switching origins is config, never code (SPEC 4).
    |
    */

    'media' => [
        'disk' => env('MEDIA_DISK', 'public'),

        // Per-image size cap for the guarded fetch, in bytes (default 10 MiB).
        'max_image_bytes' => (int) env('MEDIA_MAX_IMAGE_BYTES', 10 * 1024 * 1024),
    ],

    /*
    |--------------------------------------------------------------------------
    | Import
    |--------------------------------------------------------------------------
    |
    | Caps for the import surfaces that don't fetch a remote URL. Pasted/uploaded
    | content (#22) never touches the guarded fetcher, so it needs its own size
    | ceiling — the request is rejected (422) before a document row is created.
    | URL and GitHub imports are bounded by the fetch size cap above instead.
    |
    */

    'import' => [
        // Hard cap on directly pasted/uploaded content, in bytes (default 2 MiB).
        'max_paste_bytes' => (int) env('IMPORT_MAX_PASTE_BYTES', 2 * 1024 * 1024),
    ],

    /*
    |--------------------------------------------------------------------------
    | Instant demo mode (PLG wedge — SaaS only, SPEC §10.3, #25)
    |--------------------------------------------------------------------------
    |
    | The anonymous paste-a-URL surface. Disabled entirely when self_hosted is
    | true — the demo endpoints 404. Every knob here is a growth/abuse lever, so
    | it lives in config, never in code: the numbers are deliberately
    | conservative sane-initial-defaults, tuned at Launch against real traffic
    | (ROADMAP "Not yet specified").
    |
    */

    'demo' => [
        // How long an unclaimed demo doc lives before the scheduled prune reaps
        // it (document + versions + shares), in hours. SPEC §10.3: +48h.
        'ttl_hours' => (int) env('DEMO_TTL_HOURS', 48),

        // Aggressive per-IP rate limits (SPEC §13 demo abuse): a burst-per-minute
        // ceiling and a per-day ceiling, both keyed on the caller's IP.
        'rate_per_minute' => (int) env('DEMO_RATE_PER_MINUTE', 5),
        'rate_per_day' => (int) env('DEMO_RATE_PER_DAY', 40),
    ],

    /*
    |--------------------------------------------------------------------------
    | Diagrams — API-mediated Kroki render cache (SPEC §6.2)
    |--------------------------------------------------------------------------
    |
    | Kroki is Kedge's sole diagram engine. The API renders each diagram once per
    | (engine, source_hash), caches the SVG on the media disk, and hands the web
    | only the cached /storage URL — readers fetch a static <img>, never contact
    | Kroki, and execute zero diagram code. Repeated renders of the same diagram
    | across documents and versions hit the cache (content-addressed).
    |
    | Kroki is a trusted, operator-configured internal service, so its render
    | calls do NOT go through the SSRF guard (which would block the internal
    | http://kroki:8000 container); they use the HTTP client directly with the
    | size/timeout caps below. Only allowlisted engines are ever forwarded.
    |
    |   KROKI_URL   base URL of the Kroki service. Default hosted kroki.io is
    |               acceptable in LOCAL DEV ONLY (SPEC §6.2); the self-host
    |               compose and the SaaS run their own container (http://kroki:8000).
    |
    | DIAGRAM_SHARED_SECRET guards the internal web→api render endpoint (the
    | projection pattern, roles swapped). No default here: the middleware supplies
    | a well-known dev value and FAILS CLOSED in production if it is unset — a
    | leaked or absent secret must not turn the endpoint into an open Kroki proxy.
    |
    */

    'kroki' => [
        'url' => rtrim((string) env('KROKI_URL', 'https://kroki.io'), '/'),

        // Total transfer + connection-establishment timeouts, in seconds.
        'timeout' => (float) env('KROKI_TIMEOUT', 15),
        'connect_timeout' => (float) env('KROKI_CONNECT_TIMEOUT', 5),

        // Hard ceiling on a rendered SVG, in bytes (default 4 MiB). Kroki is
        // internal and trusted, so this is a sanity cap, not an SSRF control.
        'max_bytes' => (int) env('KROKI_MAX_BYTES', 4 * 1024 * 1024),

        // Reject a diagram source larger than this before encoding it into the
        // Kroki GET URL (default 256 KiB) — bounds abuse and over-long URLs.
        'max_source_bytes' => (int) env('KROKI_MAX_SOURCE_BYTES', 256 * 1024),
    ],

    'diagram' => [
        // Shared secret the internal render endpoint requires (see above). Null
        // when unset — the middleware decides dev-default vs. fail-closed.
        'secret' => env('DIAGRAM_SHARED_SECRET'),
    ],

];
