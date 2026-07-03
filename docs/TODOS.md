# TODOS — Margin

> Maintained by plan reviews. Effort: S/M/L/XL · Priority: P1/P2/P3.

## Decision log (CEO plan review, 2026-07-01 — all resolved)

- ✅ Approach **B′** (moat-first milestone order) — approved; applied to SPEC.md §21.
- ✅ Expansions accepted into v1: MCP server · approvals lite · suggested edits · digest post-back · instant demo mode · version diff + comment overlay · review queue. All folded into SPEC.md Rev 2.
- ✅ Plain-text projection owner: **web layer** (SPEC §5.4), `projection_version` on anchors, conformance fixtures in CI.
- ✅ All review-mandated amendments (idempotency, sync-failure isolation, MDX/Kroki caching, SVG sanitization, prompt-injection posture, Policies/IDOR, pagination, auth pinning, observability, UX states) applied to SPEC.md Rev 2.

## Decision log (self-hosting pivot, 2026-07-01 — SPEC Rev 3)

- ✅ **Self-hostable distribution**: AGPL-3.0 public repo, full feature parity (demo mode SaaS-only), Docker Compose + Caddy single-origin reference deployment, new M7 milestone. Self-hosting replaces the enterprise-SaaS trust roadmap (WorkOS SSO/SAML/SCIM dropped → generic OIDC in Later); application security (§13) unchanged.
- ✅ **Consequence — rendering shell swap**: Tailwind Plus Protocol code can't ship in a public repo → **Fumadocs** (MIT) styled to the Protocol aesthetic; Protocol demoted to design reference. M0 spike validates the fit (fallback: Nextra).
- ✅ **Consequence — PAT connector is permanent** (self-host primary path); previously scheduled for deletion at M6.
- ✅ **Consequence — Nova is optional** (SaaS-ops only), never a runtime dependency of the open-source app.

## Open TODOs (pre-implementation)

- [x] ~~P1 (S) `/design-explore` the comment gutter~~ — **done 2026-07-03**: 6 variants explored; **"Protocol Rebuild" approved** (clean-room Protocol aesthetic). Design language codified in `docs/DESIGN.md`; canonical mockup `docs/designs/review-page.html`; losing variants deleted.
- [ ] P1 (S) **Spike: port hypothes.is anchoring** (`dom-anchor-text-quote` + diff-match-patch) — validate the exact→fuzzy→orphan ladder on 2-3 real RFCs before M3 design hardens.
- [ ] P1 (S) **M0 spike: validate Fumadocs** can be restyled to `docs/DESIGN.md` tokens + the comment-gutter layout; fallback Nextra (SPEC §4.1).
- [ ] P2 (S) **Decide web-side error reporting** — Sentry in M1 vs defer; must be optional in self-host builds (SPEC §22.4).
- [ ] P2 (S) **Pick the name/domain** — "Margin" is a placeholder and becomes the public repo name (SPEC §22.1).
- [ ] P2 (S) **CLA/DCO decision** before accepting the first external contribution (SPEC §22.6).
- [ ] P3 (S) Write the register-your-own-GitHub-App guide for self-hosters (lands with M6/M7).

## Known debt (accepted deliberately)

- Polling inbox → SSE/Reverb later. (S)
- SaaS uses hosted kroki.io → move SaaS to self-hosted Kroki later (`KROKI_URL`; the self-host compose already bundles it). (S)
- TS/PHP type duplication across the API boundary → OpenAPI codegen. (M)
- Re-anchor matcher per-thread timeout budget; revisit if docs exceed ~200 threads. (S)
- ~~PAT connector stopgap → delete at M6~~ — **reversed in Rev 3**: PAT is a permanent, supported connector (self-host primary path).

## Deferred features (post-v1)

- Raw comment sync-back to GitHub/Confluence (digest post-back shipped instead)
- Team workspaces UI · generic OIDC SSO for both editions · IP allowlists/retention (schema is ready; WorkOS/SAML/SCIM dropped — self-hosting is the enterprise trust answer)
- Generic git connector (GitLab/Bitbucket/self-hosted) — `Connector` interface accommodates it
- Slack notifications · reply-by-email via Postmark inbound
- Realtime comments + presence (Laravel Reverb)
- Required reviewers + review deadlines (approvals lite shipped instead)
- Review analytics · RFC index (draft→accepted→superseded) — 12-month ideal
- localStorage draft persistence is IN scope (M2); listed here previously — moved.
