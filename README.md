# Kedge

Open-source ([AGPL-3.0](LICENSE)) spec-review platform. Paste a link to an
RFC/spec wherever it lives (GitHub, Confluence, raw URL, `.md`/`.mdx`/`.html`)
and get a beautifully rendered page with anchored comment threads, suggested
edits, version-pinned approvals, and AI review tooling. Comments survive
document versions (re-anchoring), and AI agents are first-class reviewers via
MCP. Runs as a hosted SaaS and fully self-hosted (`docker compose up`).

## Monorepo layout

```
kedge/
├── api/      # Laravel backend — REST API, auth, review data
├── web/      # Next.js + Fumadocs reading surface
├── deploy/   # docker-compose reference deployment (arrives at M7)
├── docs/     # spec, design language, todos, approved mockup
└── LICENSE   # AGPL-3.0
```

The two apps deploy independently and talk over a versioned HTTP API — never
as one atomic unit. See `docs/SPEC.md` for the product and engineering source
of truth, `docs/DESIGN.md` for the design language, and `docs/specs/` for
per-module specs.

## Prerequisites

- PHP 8.5+ and [Composer](https://getcomposer.org) (for `api/`)
- Node 20+ and npm (for `web/`, and the vite pane of the API dev script)

No paid or SaaS services are required to boot or test either app.

## api/ — Laravel backend

```bash
cd api
composer install
npm install                 # vite pane of `composer dev`
cp .env.example .env
php artisan key:generate
php artisan migrate         # SQLite by default (database/database.sqlite)
composer dev                # serve :8000 + queue worker + logs (pail) + vite
```

Health check (deploy smoke-test hook): `curl http://localhost:8000/up` → `200`.

Test and lint:

```bash
composer test               # PHPUnit feature/unit suites (never Pest)
vendor/bin/pint --dirty     # format changed files
```

SQLite is used in dev and test; queue, session, and cache all run on the
`database` driver, so a fresh clone boots with zero external services. The
`SELF_HOSTED` flag (`config/kedge.php`) distinguishes self-hosted from managed
deployments; every other external value is env-driven via `.env.example`.

## web/ — reading surface

```bash
cd web
npm install
npm run dev                 # http://localhost:3000
npm run types:check         # TypeScript check before finalizing changes
```

## Nova

[Laravel Nova](https://nova.laravel.com) is an **optional SaaS-ops add-on** for
the hosted edition — it is never installed by default and never a runtime
dependency of the open-source app. Self-hosted deployments run without it.

## License

[AGPL-3.0](LICENSE). Contributions welcome — the repo behaves as public from
commit one.
