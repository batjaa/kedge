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
