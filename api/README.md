# Kedge API

Laravel backend for [Kedge](../README.md) — the spec-review platform's REST
API, auth, and review data. See the repo root README for the monorepo overview
and `docs/SPEC.md` for the engineering source of truth.

## Boot

```bash
composer install
npm install                 # vite pane of `composer dev`
cp .env.example .env
php artisan key:generate
php artisan migrate         # SQLite by default (database/database.sqlite)
composer dev                # serve :8000 + queue worker + logs (pail) + vite
```

Health check: `curl http://localhost:8000/up` → `200`.

## Auth (Sanctum SPA cookie flow)

Session routes live at the framework root; everything resource-shaped is
versioned under `/api/v1`:

```
GET  /sanctum/csrf-cookie                       → sets XSRF-TOKEN + session cookies
POST /register  {name, email, password}         → 201, signs the account in
POST /login     {email, password}               → 200
POST /logout                                    → 204, invalidates the session
GET  /api/v1/me                                 → 200 { user, workspace }
```

Credentialed requests send the session cookie plus the `X-XSRF-TOKEN` header.
Registration silently creates the user's personal workspace (tenancy from day
one, no workspace UI). The cross-app handshake knobs — `SESSION_DOMAIN`,
`SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS` — express the dev two-port,
SaaS split-domain, and self-host single-origin topologies as pure env changes;
see the worked examples in `.env.example`.

## Test & lint

```bash
composer test               # PHPUnit (never Pest)
vendor/bin/pint --dirty     # format changed files before finalizing
```

## Conventions

Per `SPEC §4.1` and the repo AGENTS.md: PHPUnit only, Pint-clean, authorization
via Policies on every resource route, backed enums for fixed-value columns,
business logic in `app/Services/`, and `php artisan make:*` for new files.
SQLite in dev and test; queue/session/cache all on the `database` driver.
`SELF_HOSTED` (`config/kedge.php`) distinguishes self-hosted from managed
deployments. Nova is an optional SaaS-ops add-on, never a runtime dependency.
