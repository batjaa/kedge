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
    | GitHub API host
    |--------------------------------------------------------------------------
    |
    | The host every GitHub REST call targets — the blob connectors (#17/#23) and
    | the tracked-repo tree lister (M3.6) alike. `api.github.com` in every real
    | deployment; env-configurable ONLY as the test seam (SPEC §16 M3.6 testing
    | decision 3): the Playwright journeys and preview fixtures point it at a
    | loopback server that emulates the minimal repo/branches/tree endpoints. It
    | must never be changed in production — the outbound fetch still runs the full
    | SSRF guard, and a listed FETCH_ALLOW_HOSTS entry is what admits the loopback.
    |
    | `api_base` is the full base URL those calls are built on. Production and every
    | real deployment resolve it to `https://api.github.com` (byte-identical to the
    | old hardcoded scheme + host). GITHUB_API_HOST may carry a scheme in the E2E
    | seam ONLY (e.g. `http://127.0.0.1:4801`) so the Playwright journey reaches the
    | loopback fixture server over plain http — the same FETCH_ALLOW_HOSTS exemption
    | that admits it (the guard only ever lets http through for an allowlisted host).
    | A bare host keeps the https default, so nothing changes for a real deployment.
    |
    */

    'github' => [
        'api_host' => (string) env('GITHUB_API_HOST', 'api.github.com'),

        'api_base' => (static function (): string {
            $host = trim((string) env('GITHUB_API_HOST', 'api.github.com'));

            return str_contains($host, '://') ? rtrim($host, '/') : 'https://'.$host;
        })(),
    ],

    /*
    |--------------------------------------------------------------------------
    | Tracked repos (SPEC §16, M3.6)
    |--------------------------------------------------------------------------
    |
    | The file-count cap enforced at preview (and, later, scan): a recursive
    | match-everything glob on a monorepo fails loudly with an over-cap error
    | naming the count, never a workspace-flooding import (story 18). Tunable.
    |
    */

    'tracked_repos' => [
        'file_cap' => (int) env('TRACKED_REPO_FILE_CAP', 200),
    ],

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

    /*
    |--------------------------------------------------------------------------
    | AI features (SPEC §14, M4)
    |--------------------------------------------------------------------------
    |
    | BYO key: the entire AI surface is gated on a configured ANTHROPIC_API_KEY.
    | No key -> `enabled` is false, /config reports `ai.enabled: false`, the web
    | hides every AI affordance, and the AI routes 404 (the established
    | feature-flag middleware pattern). A self-hosted instance without a key is
    | complete, not crippled — there are no broken buttons to click.
    |
    | AI_ENABLED is a KILL SWITCH ONLY, the Nightwatch idiom: it can force the
    | surface off, and can never force it on. A credential is the only thing that
    | turns AI on, so no env typo can surface a button backed by no key. Test
    | suites enable the surface through config() directly, never through env.
    |
    | The provider is the v1 pin (SPEC §14: laravel/ai -> Claude), deliberately
    | NOT env-driven — a knob that could point elsewhere while the gate still
    | reads ANTHROPIC_API_KEY would let the surface enable itself against an
    | unconfigured provider. Models ARE env-overridable per SPEC §14:
    | `claude-sonnet-5` by default, with the cheap high-volume model reserved for
    | thread summaries (M4, later ticket). `pricing` is the USD-per-million-token
    | table cost accounting reads; an unpriced model records a null cost rather
    | than a wrong number.
    |
    */

    'ai' => [
        'enabled' => (static function (): bool {
            $override = env('AI_ENABLED');

            if ($override !== null && ! filter_var($override, FILTER_VALIDATE_BOOL)) {
                return false;
            }

            return filled(env('ANTHROPIC_API_KEY'));
        })(),

        'provider' => 'anthropic',
        'model' => (string) env('AI_MODEL', 'claude-sonnet-5'),
        'summary_model' => (string) env('AI_SUMMARY_MODEL', 'claude-haiku-4-5'),

        // USD per 1M tokens, per model: [input, output].
        'pricing' => [
            'claude-sonnet-5' => ['input' => 3.0, 'output' => 15.0],
            'claude-haiku-4-5' => ['input' => 1.0, 'output' => 5.0],
        ],

        // Context budget (SPEC §14). `context_tokens` is the assembled-input
        // ceiling for ONE model call — deliberately far below the model's real
        // window so the response and the instructions always fit. Over budget,
        // the builder chunks by section and merges; `max_chunks` bounds how many
        // calls one run may make, and whatever doesn't fit is reported as
        // coverage ("covers N of M threads"), never silently dropped.
        'context_tokens' => (int) env('AI_CONTEXT_TOKENS', 24000),
        'max_chunks' => (int) env('AI_MAX_CHUNKS', 4),

        // Hard ceiling on how many threads one assembly HYDRATES. The context
        // budget bounds what reaches the model; this bounds what reaches worker
        // memory, so a pathological review can't OOM the shared queue. Coverage
        // still counts against the document's REAL thread total, so exceeding
        // this is reported honestly rather than hidden.
        'max_threads' => (int) env('AI_MAX_THREADS', 500),

        // The `throttle:ai` limiter (SPEC §13), per authenticated user. Tighter
        // than the other write limiters because each request can queue a model
        // call against the workspace's key: this bounds spend, not just abuse.
        'rate_per_minute' => (int) env('AI_RATE_PER_MINUTE', 10),

        // Job-level ceiling, in seconds, sized for a chunked run (SPEC §14, eng
        // review §6). A run that blows through it lands `failed` via the terminal
        // handler — a stuck `running` row is impossible from the server side, and
        // the web poller's own ceiling covers even a hard-killed worker.
        'job_timeout' => (int) env('AI_JOB_TIMEOUT', 300),

        // How long an in-flight run may go WITHOUT SIGN OF LIFE before a fresh
        // request treats it as ABANDONED — fails it and mints a replacement (the
        // M3.6 stale-scan-takeover idiom). This is the last line against a run
        // that no worker will ever finish: a hard-killed worker never runs the
        // terminal handler, and without this every later request would join the
        // dead row forever.
        //
        // Measured from the run's last write, not its creation, so a run that sat
        // in a backed-up queue and is now genuinely working keeps renewing its
        // own lease. Still sized well past the worst legitimate quiet period
        // (one model call under job_timeout, plus backoff).
        'stale_after' => (int) env('AI_STALE_AFTER', 1800),
    ],

];
