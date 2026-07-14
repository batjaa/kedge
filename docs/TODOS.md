# TODOS — Kedge

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
- [x] ~~P1 (S) M0 spike: validate Fumadocs~~ — **done 2026-07-03: VALIDATED** (`web/` in repo, run `npm run dev`). Fumadocs 16 + Next 16 renders `.md` and `.mdx`; DESIGN.md tokens applied via `--color-fd-*` overrides; system fonts + dark default work; right TOC column swapped for a static review rail — the comment-gutter layout is feasible. Dogfooding: SPEC/DESIGN/TODOS render as content copies. **Findings for the real build:** (a) unknown fence languages (`plantuml`) crash Shiki — `langAlias` workaround in `source.config.ts`; product needs a never-crash fallback for arbitrary fence langs (add to §19 failure modes at M1); (b) content needs frontmatter — the ingestion pipeline must synthesize `title`/`description` at import; (c) M2 work identified: sticky/anchor-aligned rail, sidebar "Threads" nav group.
- [x] ~~Diagram rendering spike~~ — **done 2026-07-03: VALIDATED, then revised same day.** Final state: **Kroki is the sole diagram engine** (decision below). `remark-diagrams` converts any fence on the engine allowlist (~20 engines) → `<KrokiDiagram/>` before Shiki, for both `.md` and `.mdx`; async RSC → Kroki GET (deflate+base64url), fetch-cached, `KROKI_URL` override, SVG via `<img data:>` (no script surface), skeleton + show-source error state. Verified live: Mermaid, PlantUML (incl. SPEC.md's architecture/sequence/ER diagrams), and an Excalidraw sketch. **Findings:** (a) complex diagrams shrink to fit — click-to-zoom is genuinely needed, build at M1; (b) product needs the R2-backed SVG cache keyed by source hash (§6.2) — Next fetch cache is per-build, not shared.

## Decision log (diagram engine, 2026-07-03)

- ✅ **Kroki is the sole diagram engine** (SPEC §6.2 rewritten). Supersedes the client-Mermaid + Kroki-PlantUML split. Rationale: one code path for ~20 engines (incl. Excalidraw + PlantUML — the full sketch-to-precise spectrum), deterministic version-cacheable SVG, no mermaid ESM in the reader bundle, no in-browser diagram-parser XSS surface. **Condition attached: Kroki self-hosted in both editions from M1** — kills the third-party privacy leak that originally justified client-side Mermaid. Explicit engine allowlist; unknown fence langs fall through to plain text.
- [x] ~~P2 (S) Decide web-side error reporting~~ — **done 2026-07-11: deferred to Launch** (Import & render spec). Demo mode is SaaS-only and the SaaS has no public traffic until go-live; anything adopted must be off/optional in self-host builds. Revisit in Launch's tail.
- [x] ~~P2 (S) Pick the name/domain~~ — **done 2026-07-09: Kedge** (see decision log below).

## Decision log (naming, 2026-07-09)

- ✅ **Product named "Kedge"** /kɛdʒ/. Rationale: *kedging* = moving a ship forward by repeatedly re-setting an anchor — names the moat itself (comments re-anchoring across versions); 5-letter CLI-friendly; unique in search; best availability of all candidates checked. Runner-ups: Stet, Manicule. Availability verified 2026-07-08 via RDAP/whois: **kedge.review and kedge.ink unregistered; kedge.md likely free**; bare `github.com/kedge` taken → org **kedgehq**. Repo, docs, web app, and dogfood copies all carry the name.
- [ ] **USER ACTION** P1 (S): register `kedge.review` + `kedge.ink` (and `kedge.md` if free); create the `kedgehq` GitHub org.
- [ ] **USER ACTION** P1 (S): run a proper trademark search (USPTO/EUIPO) on "Kedge" for software/SaaS classes before public launch — note KEDGE Business School (France) exists in a different class.
- [ ] P2 (S) Logo pass: forward-tilted kedge-anchor mark per DESIGN.md Brand section.
- [ ] P2 (S) **CLA/DCO decision** before accepting the first external contribution (SPEC §22.6).
- [ ] P3 (S) Write the register-your-own-GitHub-App guide for self-hosters (lands with M6/M7).

## Decision log (web production build, 2026-07-13)

- ✅ **`web/` build script forces `NODE_ENV=production`** (`#14`). `next build` only defaults `NODE_ENV` to `production` when it is *unset*; an ambient `NODE_ENV=development` (common in dev shells / some Docker base images) leaks through, so Next bundles React's **development** build. Prerendering the synthesized `/_global-error` page against dev React then crashes with `Cannot read properties of null (reading 'useContext')`, failing the build. Root cause is the env, **not** app code — reproduced on a bare, single-page Next app and unaffected by a custom `global-error.tsx`, the bundler (webpack fails identically), or patch bumps. Fix: `"build": "NODE_ENV=production next build"` makes the build immune to the ambient value. CI's web job now runs the build (it previously only type-checked, so this was latent). Also added a provider-independent `app/global-error.tsx` as a branded, self-contained crash surface.

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
