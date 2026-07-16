# Spec: Scaffold

> Module M0 on `docs/ROADMAP.md` (charted 2026-07-10). Scope source: SPEC §21 M0; architecture: SPEC §4. Specced 2026-07-10.

## Problem Statement

An author who wants feedback on their RFC can't use Kedge at all yet: there is no backend, no accounts, and no way to sign in. The product spec is approved and the rendering spike is validated, but every module on the roadmap — importing a doc, commenting, approving — assumes an authenticated author, in a workspace, reached through a versioned API from the web app. None of that skeleton exists. Contributors face the same wall: there is nothing to boot, test, or build against.

## Solution

The walking skeleton: two deployables, wired. A visitor opens the web app, creates an account (email+password or one-click GitHub), and lands on an authenticated shell with their personal workspace silently created; the session survives reloads; sign-out works; public doc pages keep rendering with no account. A contributor boots each app with one documented command, runs tests with another, and CI enforces both — with zero paid services involved. The cross-app auth handshake (the riskiest piece) is proven by an automated browser journey, not by hand.

## User Stories

1. As an author, I want to create an account with email and password from the web app, so that I can use Kedge without a GitHub account.
2. As an author, I want to sign in with GitHub in one click, so that I don't have to manage another password.
3. As an author signing in with GitHub using an email that already has a Kedge account, I want the identities linked rather than duplicated, so that I have one account either way.
4. As an author, I want my session to persist across page reloads and browser restarts, so that I sign in once, not per visit.
5. As an author, I want to sign out and have the session actually invalidated, so that a shared machine isn't a liability.
6. As an author, I want a personal workspace created automatically at signup, so that my future documents have a home without any workspace ceremony (tenancy stays invisible in v1, SPEC §10.1).
7. As a signed-in author, I want an authenticated home shell (the future review queue's landing surface), so that signing in visibly *did* something; as a signed-out visitor hitting it, I want to be routed to sign-in and back after authenticating.
8. As a visitor with no account, I want the public doc pages (the dogfood content) to keep rendering, so that reading never requires auth.
9. As an author, I want clear, friendly error states for wrong credentials, an already-registered email, and an expired session, so that auth failures never dead-end.
10. As a contributor, I want to boot the API and the web app locally with one documented command each and no paid services, so that the barrier to hacking on Kedge is a git clone.
11. As a contributor, I want single-command test and lint runs for each app, and CI that enforces them on every push, so that the public repo stays green from commit one.
12. As a self-hoster, I want the scaffold to run without Nova, Postmark, R2, or any other SaaS dependency, so that full parity holds from the first commit (SPEC §21 standing constraint).
13. As an operator, I want a health endpoint on the API, so that deploys and compose setups can smoke-test liveness.
14. As a future integration (MCP agent, CLI), I want resource endpoints versioned under `/api/v1` from day one, so that later changes stay additive and the two deployables are never atomic (SPEC §4).
15. As a security reviewer, I want auth endpoints rate-limited and the Policy authorization pattern wired from the start, so that M1's resource routes inherit a working convention instead of inventing one.

## Implementation Decisions

**Monorepo & API scaffold.** `api/` is a fresh Laravel 13 app per the AGENTS.md conventions and SPEC §4.1: PHP 8.5, PHPUnit (never Pest), Pint, Services/Enums/Actions organization, SQLite in dev and test, Postgres in production, `QUEUE_CONNECTION`/`SESSION_DRIVER`/`CACHE_STORE` all `database`, and the 4-way `composer dev` script (serve + queue + pail + vite). No starter kit; auth is thin hand-rolled controllers over Sanctum — Fortify/Breeze bring flows (password reset, verification) that M0 defers and opinions the BFF pattern doesn't want.

**Auth & identity.** Sanctum SPA cookie mode is the only web auth mechanism (token auth arrives with MCP, M4). Session/auth routes (CSRF cookie, register, login, logout) live at the framework's conventional root; everything resource-shaped lives under `/api/v1`, starting with a "current user + workspace" endpoint. GitHub sign-in via Socialite: callback creates a user or links to an existing one by verified email match; GitHub identity (id, avatar) is stored on the user record — the workspace-level `integrations` table (SPEC §16) is for source connectors, not login. The GitHub button renders only when OAuth credentials are configured, mirroring the BYO-key pattern (SPEC §14): unconfigured features hide, never break. All auth endpoints are rate-limited (SPEC §13).

**Schema (M0 slice of SPEC §16).** `users` (password nullable — OAuth-only accounts), `workspaces`, `workspace_members` with a backed `WorkspaceRole` enum (`owner`/`member`), `audit_logs`. Registration (either path) atomically creates user + personal workspace + owner membership and writes the first audit-log entries — the audit pattern (SPEC §9) is established here, not retrofitted. No document tables yet.

**Auth handshake (pinned, SPEC §4).** Dev runs the two apps on two localhost ports; the same env knobs (`SESSION_DOMAIN`, `SANCTUM_STATEFUL_DOMAINS`, CORS origins, API base URL) must express all three topologies — dev, SaaS split-domain, self-host single-origin — with zero code changes. Client components call the API directly with credentials + XSRF header; server components go through BFF route handlers that forward incoming cookies to the API. A 401/419 from the API routes the user to sign-in, never to a raw error.

**Web promotion.** The spike graduates to the real app: sign-in and sign-up pages plus the authenticated shell, styled strictly from DESIGN.md tokens (Tailwind utilities only, system font stacks, dark-first with light theme); Fumadocs rendering, Kroki diagram pipeline, and dogfood content remain untouched and public. Unsent auth-form state needs no persistence (that pattern starts with comment drafts, M2).

**Config & flags.** `SELF_HOSTED` is plumbed as config from M0 even though nothing hides behind it until demo mode (M1). Nova is not in the default install — documented as an optional SaaS-ops add-on, never a runtime dependency (hard rule). Every external value is env-driven; committed example env files boot the stack with no secrets.

**CI.** One GitHub Actions workflow from this module: API tests + Pint check, web type check, and the Playwright job. The repo behaves as public from commit one.

**README.** Updated in the same module: monorepo layout, boot commands per app, test commands — the living-document rule.

## Testing Decisions

Two seams, agreed 2026-07-10:

1. **API HTTP seam (PHPUnit feature tests)** — the workhorse, and the house pattern every later module inherits. Tests hit the app over HTTP and assert external behavior only: status codes, cookie issuance, JSON shape of the current-user endpoint, and DB side-effects (user + workspace + owner membership + audit entries created atomically; duplicate email rejected; logout invalidates the session; guests get 401 from protected routes; rate limits trip). Socialite is faked at the provider boundary — OAuth tests cover create-new, link-by-email, and button-hidden-when-unconfigured. SQLite + `RefreshDatabase`; no mocking of anything inside the app.
2. **A Playwright journey (web)** — boots both apps against a scratch database and automates the M0 demo criterion: register through the real browser → land on the authenticated shell → reload (session persists) → sign out. This is the only automated proof that the BFF cookie handshake actually works across the two deployables. It began as a single journey (breadth deferred), and — with M0+M1 shipped — grew into a **journey pack** at `#39` (2026-07-14 review): the auth surface now also carries an `auth-edges` spec (wrong-password and duplicate-email friendly errors; the anonymous deep-link → `signin?next=` → land-back loop the `(app)` guard implements). The pack is worker-safe (every spec registers its own unique user, `web/e2e/helpers.ts`) though the run stays serial by scope choice; see the import-render Testing Decisions and the TODOS "E2E journey pack" decision log for the pack-wide conventions (deterministic fixtures, `CACHE_STORE=array` to decouple rate limiters, the sync-queue failure-mode split).

There is no prior test art in the repo; these two seams *become* the prior art. The parameterized-Policy pattern for the IDOR matrix (SPEC §18.4) gets seeded in the feature-test layer here (guest vs. member on the one protected route) so M1 extends a table rather than starting one. Web-side unit testing (Vitest) was considered and rejected for M0 — there is no pure logic to unit-test yet.

## Out of Scope

- **Password reset & email verification** — both need transactional mail, which lands with magic links in M2 (SPEC §12). Until then: no reset flow, and email+password accounts are unverified.
- **Documents, import, share links, demo mode** — M1 (Import & render).
- **Magic-link reviewer identity** — M2.
- **Sanctum personal-access tokens / MCP auth** — M4.
- **Nova installation, Forge/Vercel deployment, Docker** — SaaS-ops as needed; compose is M7; go-live is Launch.
- **Team workspace UI, roles beyond owner/member semantics** — schema only, per SPEC §10.1; UI is post-v1.
- **OpenAPI/TS codegen for API types** — accepted debt (TODOS.md); hand-written TS types at M0.

## Further Notes

- Spike findings that M0 must not regress: the Shiki `langAlias` workaround for unknown fence languages stays until M1 builds the real fallback; the dogfood content copies keep working; stale-MDX cache gotcha (`rm -rf .next .source`) stays documented in AGENTS.md.
- The "deploy api before web" rule (SPEC §4) becomes operationally real only at M1+; M0 just has to not preclude it (additive `/v1`, env-driven base URL).
- Frontmatter synthesis at import (spike finding b) is an M1 ingestion concern, not M0.
- Open decision **Web-side error reporting** (Sentry vs. defer, SPEC §22.4) is assigned to the Import & render spec per the roadmap — the M0 CI/scaffold must not bake in either answer.
