# Kedge

[![CI](https://github.com/batjaa/kedge/actions/workflows/ci.yml/badge.svg)](https://github.com/batjaa/kedge/actions/workflows/ci.yml)

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

## Quick start (repo root)

```bash
npm run setup       # install deps for both apps, bootstrap api/.env + SQLite, migrate
npm run dev         # run api (:8000) and web (:3000) together, prefixed output
npm test            # api PHPUnit + web type check
npm run test:e2e    # Playwright: boot both apps, drive the M0 demo in a real browser
```

Run one app on its own with `npm run dev:api` / `npm run dev:web` — useful when
the other side isn't needed, or when pointing the web app at a different
backend. The per-app instructions below remain the source of truth for what each
command does under the hood.

### Pointing web at a different backend

The web app's API base URL is env-driven (`web/.env.example`), so it can target
any Kedge backend without code changes. Two knobs: `API_URL` (server-side, used
by the BFF that forwards cookies) and `NEXT_PUBLIC_API_URL` (inlined into the
browser for the auth mutations). Both default to `http://localhost:8000`. Copy
`web/.env.example` to `web/.env.local` and set them to a remote API, or leave
`NEXT_PUBLIC_API_URL` empty for a same-origin reverse-proxy deployment. The
three topologies (dev two-port, SaaS split-domain, self-host single-origin) are
worked through in `web/.env.example` and `api/.env.example` in lockstep.

### End-to-end journey (Playwright)

One browser journey proves the cross-app auth handshake — the riskiest piece of
the walking skeleton — end to end: register through the real UI, land on the
authenticated shell, reload (session persists), sign out. It is deliberately a
single journey, not a suite.

```bash
npx playwright install chromium   # one-time: fetch the browser
npm run test:e2e                  # boots api + web, drives the journey, tears them down
```

`npm run test:e2e` needs nothing running first — Playwright boots both apps
itself (`web/playwright.config.ts`). The API runs against a throwaway SQLite
database migrated fresh each run (`web/e2e/serve-api.sh`), so it never touches
your dev data, and re-runs never collide. The same journey runs as the `e2e`
job in CI.

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
