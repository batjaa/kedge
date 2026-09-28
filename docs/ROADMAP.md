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
| Projects & tracked repos | M | Documents list | done (2026-07-21) | [specs/m3.6-projects-tracked-repos.md](specs/m3.6-projects-tracked-repos.md) · [#89](https://github.com/batjaa/kedge/issues/89) |
| Design refresh | M | Documents list · Projects & tracked repos | done (2026-07-23) | [specs/m3.7-design-refresh.md](specs/m3.7-design-refresh.md) · [#97](https://github.com/batjaa/kedge/issues/97) |
| Activity & landing | M | Design refresh | done (2026-07-24) | [specs/m3.8-activity-landing.md](specs/m3.8-activity-landing.md) · [#107](https://github.com/batjaa/kedge/issues/107) |
| Web i18n | M | Activity & landing · Source provenance | done (2026-07-25) | [specs/m3.9-i18n.md](specs/m3.9-i18n.md) · [#121](https://github.com/batjaa/kedge/issues/121) |
| Source provenance | S | Projects & tracked repos · Design refresh | done (2026-07-24) | [specs/m3.10-source-provenance.md](specs/m3.10-source-provenance.md) · [#115](https://github.com/batjaa/kedge/issues/115) |
| AI & agents | M | Comments & suggestions · Versions, diff & approvals | done (2026-08-18) | [specs/m4-ai-agents.md](specs/m4-ai-agents.md) · [#128](https://github.com/batjaa/kedge/issues/128) |
| Workspace membership & authorization | L | Scaffold · AI & agents | specced (2026-09-27); engineering review in progress | [specs/m4.0-workspace-membership.md](specs/m4.0-workspace-membership.md) |
| Project access | L | Workspace membership & authorization · Projects & tracked repos · Comments & suggestions · Versions, diff & approvals · AI & agents | rebase pending workspace foundation | [specs/m4.1-project-access.md](specs/m4.1-project-access.md) |
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
- **Design refresh** (M3.7, wedge 2026-07-23) — the locked Open Harbor baseline product-wide (light-first, self-hosted Space Grotesk display, amended tokens); dashboard upgrade (projects rail, stats strip + workspace summary endpoint, server-side lifecycle filters on shared query scopes, poller-debt fix bundled); workspace General settings with audited rename.
- **Activity & landing** (M3.8, wedge 2026-07-23) — audit-log activity feed (review-action instrumentation M5 will reuse; aggregate re-sync events; snapshot meta; allowlisted projection — never ip/raw meta); SaaS marketing landing with the demo import in the hero (self-host branch unchanged).
- **Web i18n** (M3.9, wedge 2026-07-23) — en-US · es-US · mn-MN · de-DE via next-intl without locale routing (strict-allowlist cookie + negotiation, en-US merge fallback); mn-MN display font falls back to the system stack (no Cyrillic in Space Grotesk); chip strings as a constrained glossary; document content never translated. Runs after M3.10 so the glossary snapshots stable strings.
- **Source provenance** (M3.10, wedge 2026-07-24) — read-only provenance chips on every row (repo path · owner/repo + path · host · pasted) derived server-side from stored columns; project pages group repo-sourced docs under their tracked repo, path-ordered with directory dividers (flattened tree — projects stay the only user-managed hierarchy, wikis/folders non-goal intact); `tracked_repo` filter + `order=path` on the shared list query. Group-by-source toggle deferred.
- **AI & agents** (M4) — digest, improve-prompt, reply drafts, comment split, thread summaries, `ai_runs` UI; MCP server with agent badges.
- **Workspace membership & authorization** (M4.0, specced 2026-09-27) — extensible action/role catalogs; Owner/Admin/Member/Viewer defaults; workspace invitations, explicit selection, administration and live resource authorization. Custom-role editing follows later. [Module spec](specs/m4.0-workspace-membership.md).
- **Project access** (M4.1, specced 2026-09-26) — invite by email, accept into a project, discover and review its documents within a role, manage pending invitations/members, and remove access. No implicit workspace membership; direct project grants extend the workspace foundation. Rebase pending. [Module spec with prior confirmed product decisions](specs/m4.1-project-access.md).
- **Notifications & review queue** (M5) — in-app inbox, Postmark email, mentions, digest scheduling, per-user prefs, review-queue dashboard.
- **Private sources & post-back** (M6) — GitHub App with push-webhook auto re-sync, Confluence import via API token, digest post-back to PR/Confluence.
- **Self-host distribution** (M7) — `deploy/` compose + Caddy single-origin, tagged images, migrate-on-boot, telemetry ping + opt-out, backup/upgrade/self-hosting guides, public-repo hygiene (CONTRIBUTING, SECURITY.md).
- **Launch** (new 2026-07-10) — SaaS go-live: SPEC §20.1 bootstrap checklist (DNS, Postmark DKIM, R2, Forge, OAuth apps), initial demo-mode rate limits, first tagged release, announcement. Gated by user actions (domains, org, trademark — TODOS.md).

## Open decisions

Work these one per session (`/wayfinder` work mode):

**Workspace membership & authorization — engineering review in progress (2026-09-27).**
The [M4.0 spec](specs/m4.0-workspace-membership.md) defines the built-in matrix,
code-backed extensibility interface, all-projects/Unfiled baseline visibility,
invitation/selection/admin lifecycle and independent-grant removal semantics.
These are concrete spec defaults for review, not a claim that every choice was
separately approved. The [review log](plans/workspace-membership-eng-review.md) records
1A full scope, 2A membership lifecycle model, 3A explicit workspace routes and
4A separate share-review routes without legacy compatibility, and 5A settled demo
claiming, plus 6A RFC 9457 errors and uncertain-write recovery. Architecture review
and error/rescue reviews are complete, including 7A durable AI progress and safe
resumption after interruption. Security review is in progress.
Complete the remaining review before ticketing. The prior project
[spec](specs/m4.1-project-access.md) and unpublished [ticket structure](plans/project-access-tickets.md)
remain rebase-pending; do not publish their old dependency order.

1. ~~**Anchoring port spike** (P1, S)~~ — **RESOLVED (M3, 2026-07-20)**: the exact→fuzzy→orphan ladder shipped (#76/#77) on `@sanity/diff-match-patch`, validated by the Vitest re-anchoring golden corpus (the moat regression net). (TODOS.md)
2. **CLA/DCO** (P2, S) — decide before the first external contribution; blocks CONTRIBUTING in **Self-host distribution** and therefore **Launch**. (SPEC §22.6)
3. **Domains, org & trademark** (P1, user actions) — register kedge.review/kedge.ink, create the kedgehq org, USPTO/EUIPO search. Gates **Launch**. (TODOS.md)

## Decisions so far

- **Workspace foundation specced (2026-09-27)** — [M4.0](specs/m4.0-workspace-membership.md) defines Owner/Admin/Member/Viewer, Member-default invitations, code-backed action/role definitions with a future custom-role provider seam, explicit workspace targets and live resource authorization. Membership covers all workspace projects/Unfiled; source credentials remain Owner-only; independent Shares survive removal. These are spec defaults awaiting review.

- **Workspace authorization first (2026-09-27)** — user redirected the sequence: define expandable workspace membership, ship useful defaults, and specify action/role interfaces as the resource-authorization baseline before project membership. This supersedes the earlier project-first order; [foundation draft](plans/workspace-membership.md) records the original proposals; the [M4.0 spec](specs/m4.0-workspace-membership.md) now supplies the concrete contract.

- **Project content/moderation confirmed (2026-09-26)** — Maintainers manage project details, document lifecycle, pasted/uploaded versions, threads, suggestions, and inappropriate-comment deletion; nobody rewrites another author's comments or approves on their behalf. Reviewers manage their own contributions; Viewers remain read-only. Product decisions are complete. [Module spec](specs/m4.1-project-access.md).

- **Project invitation lifecycle confirmed (2026-09-26)** — seven-day expiry; resend replaces the link and restarts expiry; acceptance requires the invited verified account; pre-acceptance revocation; loss of inviter authority cancels pending invitations. [Module spec](specs/m4.1-project-access.md).

- **Project document moves confirmed (2026-09-26)** — Maintainers may move between two projects they maintain in the same workspace; the workspace owner may also move to/from Unfiled. Reauthorize both ends at commit; cross-workspace moves remain out of scope. [Module spec](specs/m4.1-project-access.md).

- **Project document sharing confirmed (2026-09-26)** — Maintainers may create, list, and revoke document share links within the project. Viewers and Reviewers cannot manage shares. Removal preserves independent share grants until explicit revocation, with clear remaining-access copy and a link-management action (confirmed 2026-09-26). [Module spec](specs/m4.1-project-access.md).

- **Project AI access confirmed (2026-09-26)** — Reviewers generate Ask answers and reply drafts; Maintainers use all existing AI tools; Viewers read shared results only. Personal questions/drafts remain private; existing provider gates/rate limits apply. [Module spec](specs/m4.1-project-access.md).

- **Project source management confirmed (2026-09-26)** — Maintainers manage sources, branches/path filters, imports, and scans; private repositories require owner approval per project. Credentials and Repository Approvals stay owner-controlled. [Module spec](specs/m4.1-project-access.md).

- **Project roles confirmed (2026-09-26)** — Viewer, Reviewer, and Maintainer; Reviewer is the default invitation role. Membership administration is confirmed: Maintainers manage Viewers/Reviewers, only the owner manages Maintainer seats, and members may leave voluntarily. The complete capability matrix is now confirmed. [Module spec](specs/m4.1-project-access.md).

- **Project access pulled forward; workspace management follows later (historical; sequence superseded 2026-09-27)** — user direction, 2026-09-26. Invitation grants only the project; preserve an expansion path to workspace membership. [Module spec](specs/m4.1-project-access.md) records confirmed product decisions; testing uses agreed PHPUnit API features, Playwright journeys, database concurrency checks, and a real-mail deployment smoke test.
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
- **Design-refresh wedge before M4, split three ways** — the 2026-07-23 Open Harbor design lock turned into modules: restyle + dashboard/activity + SaaS landing + web-UI i18n, full scope user-directed at speccing; the one-L-module bundle was split M3.7/M3.8/M3.9 at eng review (2026-07-23) so each ends demoable with a small merge (the 74-commit M3.6 branch was the cautionary tale). Landing pulled forward from Launch; activity instrumentation front-runs M5's inbox deliberately; i18n runs last against stable strings.
- **A PR is a candidate version, not a separate document** — constrains the Versions module's lineage schema (lineage-with-candidates, not linear-only) — [ADR 0001](adr/0001-pr-is-a-candidate-version.md), 2026-07-15.
- **Organization language pinned: Project (container) + Source (origin)** — a repo is a source, never the container (monorepos and mixed-source efforts break the 1:1); issues attach as References, never import — CONTEXT.md, 2026-07-15.

## Not yet specified

- **Demo-mode abuse thresholds** — real per-IP numbers only knowable after public traffic; tune in Launch's tail. (SPEC §22.5)
- **Confluence macro conversion coverage** — which macros beyond panels/code get converters; sharpens against real pages when Private sources & post-back is specced.
- **Sync agent** (IDEAS.md) — push-model sync: a CLI/CI step pushes content to Kedge instead of Kedge pulling. May fall out of `POST /documents {content}` plus a thin CLI; post-v1 unless the destination is redrawn.
- **Raw/source view** (IDEAS.md) — "raw view of html, md" alongside the rendered template; too blurry to phrase as a decision yet.
- **References & PR sources** (post-v1) — attach external References and resolve PR URLs to candidate versions (ADR 0001). Project containers shipped in M3.6; project access is now planned in M4.1. These remaining source/reference capabilities are separate future scope.

## Out of scope

- **In-app document editing** — Kedge is a review surface; revisions flow through the source. Suggested edits are proposals, not writes. (SPEC §2)
- **Raw comment sync-back to GitHub/Confluence** — digest post-back only in v1.
- **Realtime cursors/presence** — polling v1; Reverb later.
- **Enterprise SSO/SAML/SCIM** — self-hosting is the v1 enterprise trust answer; generic OIDC is post-v1.
- **Billing, SSO and team groups** — remain later scope. Workspace membership and its authorization foundation are specced in M4.0 before project access.
- **Cross-document search, wikis, folders** — the review queue is the only aggregation surface in v1.
