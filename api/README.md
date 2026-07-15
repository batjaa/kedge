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
GET  /api/v1/config                             → 200 { auth: { github } } (public capabilities)
GET  /auth/github/redirect                      → 302 github.com (or 404 if unconfigured)
GET  /auth/github/callback                      → create-or-link, then 302 to FRONTEND_URL
```

Credentialed requests send the session cookie plus the `X-XSRF-TOKEN` header.
Registration silently creates the user's personal workspace (tenancy from day
one, no workspace UI). The cross-app handshake knobs — `SESSION_DOMAIN`,
`SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS` — express the dev two-port,
SaaS split-domain, and self-host single-origin topologies as pure env changes;
see the worked examples in `.env.example`.

### GitHub sign-in (optional, Socialite)

One-click sign-in. First sign-in creates the account through the same atomic
path as email registration (user + personal workspace + owner membership +
audit, password `null`); a GitHub account whose **verified primary email**
matches an existing account links to it instead of duplicating — one account
either way. The `github_id` lives on the `users` row (the workspace-level
`integrations` table stays reserved for source connectors).

The feature is **off until credentials are set**: with `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` empty the two `/auth/github/*` routes return 404 and
`/api/v1/config` reports `auth.github: false`, so the web app hides the button
(BYO-key pattern, SPEC §14). The redirect/callback use the session-based
Socialite driver (both legs are top-level navigations to this API's origin, so
CSRF `state` validation is kept), and all three routes share the per-IP `auth`
rate limiter.

To enable it, register a GitHub OAuth app at
<https://github.com/settings/developers> → **New OAuth App**:

| Field                       | Value (dev)                                  |
| --------------------------- | -------------------------------------------- |
| Application name            | `Kedge` (or your instance name)              |
| Homepage URL                | `http://localhost:3000` (your `FRONTEND_URL`) |
| Authorization callback URL  | `http://localhost:8000/auth/github/callback` |

Then set in `api/.env` (the callback URL must match `APP_URL` exactly — the
default `GITHUB_REDIRECT_URI` derives from it):

```
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<generated secret>
FRONTEND_URL=http://localhost:3000
```

For the SaaS split-domain / self-host topologies, point Homepage URL at the web
origin, the callback URL at `<API origin>/auth/github/callback`, and set
`FRONTEND_URL` to the web origin.

### Private-repo imports (per-workspace PAT)

The `/settings` page connects a GitHub personal access token for importing
private files. Its "create a token" link deep-links to GitHub's **fine-grained
token** form pre-filled with the minimum Kedge needs (`contents=read` — Metadata
read is implied; 90-day expiry) — the user only picks **"Only select
repositories"**.

Fine-grained tokens are scoped to **one resource owner**. The form defaults to
the personal account, so org-owned repos only appear when the org is the owner —
the settings panel's org field bakes `target_name=<org>` into the link, because
switching owner inside GitHub's form drops the pre-filled permissions. Orgs can
block fine-grained tokens or require approval of them. Two cases still need a
**classic token**
(`https://github.com/settings/tokens/new?scopes=repo&description=Kedge+imports`):
repos owned by *another user* where you're only a collaborator (a hard
fine-grained limitation), and orgs that block fine-grained tokens outright. The
`repo` scope is much broader than Kedge uses — prefer fine-grained wherever it
works.

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
