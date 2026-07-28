# Preview deployment (home server)

An early, minimal prototype of the M7 self-host topology (SPEC §20.2), used to
run a preview instance on personal infrastructure via
[Coolify](https://coolify.io) with the `dockercompose` build pack. **This is
not the reference self-host deployment** — that arrives at M7 in `deploy/`
proper, with the bundled Kroki container, migrate-on-boot policy docs, tagged
images, and backup/upgrade guides.

## Shape

Single origin. Caddy (`proxy/`) routes on one domain:

- `/api/bff/*` → **web** (Next.js route handlers — must not hit Laravel)
- `/api/*`, `/sanctum/*`, `/auth/*`, `/login`, `/logout`, `/register`, `/up`, `/storage/*` → **api**
- everything else → **web**

Same-origin cookies, zero CORS configuration — the third topology worked
through in `api/.env.example` and `web/.env.example`.

Services: `proxy` (the domain points here), `api` + `worker` + `scheduler`
(one image, three modes via `api/docker/entrypoint.sh`), `web`, `db`
(postgres 16). Migrations run on `api` boot only.

## Env

Set in the deployment platform: `APP_URL`, `APP_KEY`, `DB_DATABASE`,
`DB_USERNAME`, `DB_PASSWORD`. Optional: `GITHUB_CLIENT_ID`/`SECRET` (OAuth
button hides when unset), `SELF_HOSTED` (defaults `false` here since M3.8: the
preview shows the SaaS edition — marketing landing + hero demo; set `true` in
the platform env to preview the self-hosted sign-in branch).
`SANCTUM_STATEFUL_DOMAINS` and `FRONTEND_URL` derive from `APP_URL` when
unset. `NEXT_PUBLIC_API_URL` is a build arg baked empty — same-origin relative
calls behind the proxy. Optional: `NIGHTWATCH_TOKEN` (Laravel Nightwatch
observability, 2026-07-28) — unset means fully off (package no-ops, no agent
starts); set it and the api entrypoint runs the agent in-container on
`0.0.0.0:2407`, with worker/scheduler shipping to `api:2407`.

## Known preview-grade shortcuts (revisit at M7)

- `php artisan serve` as the app server (fine for a preview; M7 uses FrankenPHP).
- No TrustProxies configuration in api source; `SESSION_SECURE_COOKIE=true` is
  set explicitly instead. TLS terminates upstream (SWAG → Coolify proxy).
- Single-stage web image (no standalone output pruning).
- No Kroki container yet — lands with the M1 diagram ticket, add it here then.
- Nightwatch agent runs inside the api container (entrypoint backgrounds it
  when `NIGHTWATCH_TOKEN` is set). M7's reference compose should use the
  official `laravelphp/nightwatch-agent` sidecar image — as an optional
  service, never a required one.
