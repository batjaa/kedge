# Roadmap: Kedge v1

> Charted 2026-07-10 via `/wayfinder` from SPEC.md (Rev 3, §21 milestone plan), TODOS.md, and IDEAS.md.
> This file is an index, not a store: module scope detail lives in SPEC §21; decision detail lives where each decision was made. Statuses here are the working truth.

## Destination

Both editions live. A stranger pastes a public spec URL at **kedge.review** and gets a beautifully rendered doc with zero signup; a company runs `docker compose up` and reviews private RFCs on its own network — anchored comments that survive re-syncs, version-pinned approvals, and AI agents reviewing over MCP. Launch is inside this effort, not a follow-on (decided 2026-07-10, this charting).

## Modules

Modules map 1:1 onto SPEC §21's milestones (M0–M7), which were CEO-approved in B′ (moat-first) order and are already vertical — each ends demoable. Launch is new scope from the destination decision. "Depends on" is build order; a `ready-to-spec` module behind an unbuilt dependency can still be specced.

| Module | Size | Depends on | Status | Spec |
|---|---|---|---|---|
| Scaffold | M | — | done (2026-07-12) | [specs/m0-scaffold.md](specs/m0-scaffold.md) · [#7](https://github.com/batjaa/kedge/issues/7) |
| Import & render | L | Scaffold | done (2026-07-15) | [specs/m1-import-render.md](specs/m1-import-render.md) · [#15](https://github.com/batjaa/kedge/issues/15) |
| Comments & suggestions | L | Import & render | done (2026-07-16) | [specs/m2-comments-suggestions.md](specs/m2-comments-suggestions.md) · [#58](https://github.com/batjaa/kedge/issues/58) |
| Versions, diff & approvals | L | Comments & suggestions | done (2026-07-20) | [specs/m3-versions-diff-approvals.md](specs/m3-versions-diff-approvals.md) · [#72](https://github.com/batjaa/kedge/issues/72) |
| Documents list | S | Versions, diff & approvals | done (2026-07-21) | [specs/m3.5-documents-list.md](specs/m3.5-documents-list.md) · [#82](https://github.com/batjaa/kedge/issues/82) |
| Projects & tracked repos | M | Documents list | specced (2026-07-21) | [specs/m3.6-projects-tracked-repos.md](specs/m3.6-projects-tracked-repos.md) |
| AI & agents | M | Comments & suggestions · Versions, diff & approvals | specced (2026-07-20) | [specs/m4-ai-agents.md](specs/m4-ai-agents.md) |
| Notifications & review queue | M | Comments & suggestions · Versions, diff & approvals | ready-to-spec | — |
| Private sources & post-back | M | Import & render · Versions, diff & approvals · AI & agents | ready-to-spec | — |
| Self-host distribution | M | everything above | deciding | — |
| Launch | M | Self-host distribution | deciding | — |

Gists (full scope + demo criteria: SPEC §21):

- **Scaffold** (M0) — monorepo + `api/` Laravel 13 recipe (Sanctum, Socialite, Policies, enums; Nova optional), promote the `web/` spike, pinned BFF auth handshake. Demo: log in from the Next.js app.
- **Import & render** (M1) — public GitHub / raw URL / upload / PAT connectors, normalization with warnings, web-owned text projection, Fumadocs rendering, self-hosted Kroki diagrams, MDX allowlist + fallback, share links, instant demo mode.
- **Comments & suggestions** (M2) — selection anchors, threads/replies/resolve/fork, suggested edits with accept/decline, magic-link reviewer identity, orphan-tray shell.
- **Versions, diff & approvals** (M3) — manual re-sync, re-anchoring ladder (hypothes.is port), version switcher, diff view with comment overlay, approvals lite with staleness.
- **Documents list** (M3.5, wedge 2026-07-21) — authenticated home lists all workspace docs with lifecycle/threads/sync chips, live import-status polling, inline retry. Pulls the "Your docs" half of SPEC §11 forward from M5.
- **Projects & tracked repos** (M3.6, wedge 2026-07-21) — projects as free containers with dedicated pages, doc assignment + Unfiled bucket; tracked repos (URL + ref + path pattern → preview → bulk import) with manual Re-scan; webhook watching stays M6. Term pinned 2026-07-21 (was "repo sources").
- **AI & agents** (M4) — digest, improve-prompt, reply drafts, comment split, thread summaries, `ai_runs` UI; MCP server with agent badges.
- **Notifications & review queue** (M5) — in-app inbox, Postmark email, mentions, digest scheduling, per-user prefs, review-queue dashboard.
- **Private sources & post-back** (M6) — GitHub App with push-webhook auto re-sync, Confluence import via API token, digest post-back to PR/Confluence.
- **Self-host distribution** (M7) — `deploy/` compose + Caddy single-origin, tagged images, migrate-on-boot, telemetry ping + opt-out, backup/upgrade/self-hosting guides, public-repo hygiene (CONTRIBUTING, SECURITY.md).
- **Launch** (new 2026-07-10) — SaaS go-live: SPEC §20.1 bootstrap checklist (DNS, Postmark DKIM, R2, Forge, OAuth apps), initial demo-mode rate limits, first tagged release, announcement. Gated by user actions (domains, org, trademark — TODOS.md).

## Open decisions

Work these one per session (`/wayfinder` work mode):

1. ~~**Anchoring port spike** (P1, S)~~ — **RESOLVED (M3, 2026-07-20)**: the exact→fuzzy→orphan ladder shipped (#76/#77) on `@sanity/diff-match-patch`, validated by the Vitest re-anchoring golden corpus (the moat regression net). (TODOS.md)
2. **CLA/DCO** (P2, S) — decide before the first external contribution; blocks CONTRIBUTING in **Self-host distribution** and therefore **Launch**. (SPEC §22.6)
3. **Domains, org & trademark** (P1, user actions) — register kedge.review/kedge.ink, create the kedgehq org, USPTO/EUIPO search. Gates **Launch**. (TODOS.md)

## Decisions so far

- **Approach B′, moat-first milestone order** — CEO plan review, TODOS.md decision log 2026-07-01.
- **Seven v1 expansions** (MCP server, approvals lite, suggested edits, digest post-back, instant demo mode, diff view + comment overlay, review queue) — SPEC.md Rev 2.
- **Self-hostable distribution** (AGPL-3.0, full parity, compose reference; Fumadocs replaces Protocol code; PAT permanent; Nova optional) — SPEC.md Rev 3, TODOS.md 2026-07-01.
- **Text projection owned by the web layer** — SPEC §5.4.
- **Kroki is the sole diagram engine**, self-hosted in both editions — SPEC §6.2, TODOS.md 2026-07-03.
- **Design language approved** ("Protocol Rebuild", clean-room) — DESIGN.md, mockup `docs/designs/review-page.html`, 2026-07-03.
- **Fumadocs shell validated** (spike, `web/` in repo) — TODOS.md 2026-07-03.
- **Confluence auth: per-user API tokens first**, OAuth 2.0 (3LO) when a team adopts — SPEC §22.2.
- **Product named Kedge** (kedge.review / kedge.ink, org kedgehq) — TODOS.md 2026-07-09.
- **Destination includes launch of both editions** — this charting, 2026-07-10.
- **Sync-agent idea stays in the fog** (v1 is pull-based via connectors) — this charting, 2026-07-10.
- **Web-side error reporting deferred to Launch** (SaaS has no public traffic before go-live; must be off/optional self-hosted either way) — Import & render speccing, 2026-07-11.
- **Workspace UX wedge before M4** (M3.5 documents list → M3.6 projects & tracked repos) — dogfooding pain: invisible imports, no multi-import progress, no organization, one-by-one import; M4's agent flows demo far better against an organized repo-full of docs. TODOS.md decision log 2026-07-21.
- **A PR is a candidate version, not a separate document** — constrains the Versions module's lineage schema (lineage-with-candidates, not linear-only) — [ADR 0001](adr/0001-pr-is-a-candidate-version.md), 2026-07-15.
- **Organization language pinned: Project (container) + Source (origin)** — a repo is a source, never the container (monorepos and mixed-source efforts break the 1:1); issues attach as References, never import — CONTEXT.md, 2026-07-15.

## Not yet specified

- **Demo-mode abuse thresholds** — real per-IP numbers only knowable after public traffic; tune in Launch's tail. (SPEC §22.5)
- **Confluence macro conversion coverage** — which macros beyond panels/code get converters; sharpens against real pages when Private sources & post-back is specced.
- **Sync agent** (IDEAS.md) — push-model sync: a CLI/CI step pushes content to Kedge instead of Kedge pulling. May fall out of `POST /documents {content}` plus a thin CLI; post-v1 unless the destination is redrawn.
- **Raw/source view** (IDEAS.md) — "raw view of html, md" alongside the rendered template; too blurry to phrase as a decision yet.
- **Projects & references** (post-v1) — the Project container, attaching documents/references, and a PR-URL connector resolving to candidate versions (per ADR 0001). Language is pinned in CONTEXT.md; scheduling waits until v1's non-goal ("no folders") is deliberately reopened — nearest existing later-item is the RFC index.

## Out of scope

- **In-app document editing** — Kedge is a review surface; revisions flow through the source. Suggested edits are proposals, not writes. (SPEC §2)
- **Raw comment sync-back to GitHub/Confluence** — digest post-back only in v1.
- **Realtime cursors/presence** — polling v1; Reverb later.
- **Enterprise SSO/SAML/SCIM** — self-hosting is the v1 enterprise trust answer; generic OIDC is post-v1.
- **Billing & team workspace management UI** — schema is tenancy-ready; no UI in v1.
- **Cross-document search, wikis, folders** — the review queue is the only aggregation surface in v1.
