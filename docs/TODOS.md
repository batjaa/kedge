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

## Decision log (M1 import tracer bullet, 2026-07-13)

- ✅ **Raw-URL import spine shipped** (`#17`, first slice of M1). `documents` + `document_versions` per SPEC §16 (backed enums `DocumentStatus`/`LifecycleStatus`/`SyncStatus`/`DocumentFormat`/`SourceType`, `(document_id, content_hash)` unique, un-constrained `current_version_id` pointer — a hard FK there would be circular with `document_versions.document_id`). `POST /api/v1/documents` → Policy → `importing` → `ImportDocumentJob` (`ShouldBeUnique`) → 202; `GET /documents/{id}` polls; `POST /documents/{id}/retry` for the §19 failure CTA. Blocked URLs (SSRF guard) fail the import **immediately with no retries** — deterministic, unlike transient timeouts/5xx which retry ×3 with backoff.
- ✅ **`Connector` interface extended with `sourceType(): SourceType`** beyond SPEC §5.1's four methods, so each connector owns its `documents.source_type` value and the registry stays additive for GitHub/Confluence (`#22`/`#23`). `integration_id` column exists (nullable, no FK) for the PAT connector.
- ✅ **Interim markdown renderer** (`web/lib/render-markdown.tsx`): unified + remark-rehype **without `allowDangerousHtml`** (raw HTML/`<script>` dropped, never parsed) + an href/src scheme allowlist (strips `javascript:` links), output as real React elements (no `dangerouslySetInnerHTML`). This is the deliberately-simple safe path — the hardened MDX pipeline (`#20`) and Kroki diagrams (`#21`) replace/widen it. Unknown fence languages render as plain `<pre><code>` (no highlighter to crash), satisfying the never-crash rule early.
- ✅ **`DocumentResource` is unwrapped** (`$wrap = null`) to match M0's `CurrentUserResource` house shape; `AuthorizesRequests` added to the base `Controller` so every resource controller can `$this->authorize()`.

## Decision log (M1 normalization, 2026-07-14)

- ✅ **Normalization shipped** (`#19`, SPEC §5.2). Lives in its own service `App\Services\Import\Normalization` (`Normalizer` orchestrator → `HtmlNormalizer` + `ImageReHoster` + `SvgSanitizer`), invoked from `DocumentImporter` at **one call site** so `#18`'s projection call stays a clean additive edit. `.html` (by content type **or** URL extension) → sanitize → markdown; everything else passes through as markdown. Nothing throws on bad content: HTML that won't convert degrades to recovered `strip_tags` text + warning; images that won't fetch keep their original URL + warning.
- ✅ **Sanitizer choices.** `symfony/html-sanitizer` (safe-element allowlist) for the HTML→markdown pre-pass — drops `<script>`/`<style>`/`<iframe>`, every event handler and inline style, and `javascript:` URLs before league/html-to-markdown (+ its `TableConverter` for GFM tables) ever sees them. `enshrined/svg-sanitize` for SVG bytes — SVG is namespaced XML with its own script surface, so a maintained SVG-aware sanitizer beats a hand-rolled allowlist and beats the HTML sanitizer (which would gut the drawing). Both are maintained; no proprietary code.
- ✅ **Image re-hosting → `MEDIA_DISK`** (env, default `public` served via the `/storage` symlink; S3/R2 on SaaS). Every referenced image is fetched through the existing `GuardedFetcher` (SSRF guard reused, not re-implemented), stored content-addressed at `media/{documentId}/{sha256}.{ext}` (idempotent re-imports, stable doc hash), URL rewritten in the normalized markdown. SVGs are sanitized before storage.
- ✅ **Import warnings persist on the version.** New nullable JSON `document_versions.import_warnings` (a property of the snapshot, not the document identity); `{type, message}` shape, hand-mirrored to `web/lib/document-types.ts`. Every failed image fetch / degraded conversion is a warning; the import **continues** (SPEC §19). Surfaced author-facing as a collapsible amber `<details>` panel on the doc page (`web/components/app/import-warnings.tsx`, DESIGN.md callout anatomy, one-line mount).

## Decision log (M1 MDX security pipeline, 2026-07-14)

- ✅ **Hardened MDX render path shipped** (`#20`, SPEC §6.1). `@mdx-js/mdx` compiles imported MDX in the web server layer; the compiled artifact is cached by content hash. `lib/remark-mdx-harden.ts` runs on the mdast after `remark-diagrams` and is the security gate: rejects `import`/`export` and non-literal expressions (incl. expression-valued + spread attributes — closing the attribute-channel injection that `unist-util-visit` never descends into), allowlists JSX to `Callout`/`Note`/`Warning`/`CodeGroup`/`Tabs`/`KrokiDiagram`, rewrites unknown components to a neutral `<UnsupportedComponent>` box, and sanitizes intrinsic HTML. `.md` docs keep the `#17` renderer (raw HTML dropped) unchanged; the doc page + share page branch through one shared `DocumentBody`.
- ✅ **rehype-sanitize cannot govern MDX — architecture deviation from SPEC §6.1's literal wording.** In MDX every angle-bracket construct (a `<Callout>` **and** a raw `<script>`) parses to an `mdxJsx*Element` node, never a hast `element`/`raw` node; `hast-util-sanitize` only handles element/text/comment/root and silently **drops every other node type** — verified: dropping `rehype-sanitize` into the pipeline deletes the allowlisted components too. So the tight schema is enforced in the harden plugin at the mdxJsx level, **reusing `rehype-sanitize`'s `defaultSchema`** (tag/attribute/protocol allowlists) as the schema source of truth — "raw HTML sanitized against rehype-sanitize's tight schema" holds in substance, not by wiring the plugin into a tree it would gut. SPEC §6.1 amended to record the mechanism + rationale.
- ✅ **Compile cache = in-process LRU + on-disk compiled-source layer** (`lib/mdx.tsx`). A compiled `MDXContent` is a live closure (unserializable), so L1 (LRU of the run outcome, keyed by `sha256(content)`) is where "render per request without recompiling" happens — shared across requests because Next is a long-lived process, not a per-build cache. L2 caches the compiled JS **source string** (`compile()` output, before `run()`) on disk (`MDX_CACHE_DIR`, default tmp) so the expensive parse+transform survives cold starts and is shared across workers on a host; best-effort, never holds failures, any disk error falls through to recompile. Key derived from content (equivalent to the API's `content_hash`), so validation-at-import warms the cache render-at-request reuses.
- ✅ **`mdx_ok` is real and stored** (additive nullable `document_versions.mdx_ok`). The projection endpoint runs the **same hardened compile** as render to decide `mdx_ok` (the one definition of "what this document is", SPEC §5.4/§6.1): null for non-MDX, true = compiled, false = rejected/uncompilable. The importer passes the **freshly detected** format (not the creation-time `md` default) to the projector — the bug that would otherwise skip MDX validation entirely — stores `mdx_ok`, and logs `mdx.compile_failed` on false. `.mdx` is detected at import by URL/filename extension (`Normalizer`). A false `mdx_ok` is a **fallback, not an import failure**: the doc is `ready` and renders plain markdown + banner.
- ✅ **Spike `langAlias` workaround deleted** (`web/source.config.ts`). Replaced the special-case `langAlias: { plantuml: 'txt' }` with fumadocs' general `rehypeCodeOptions.fallbackLanguage: 'plaintext'` — every unknown fence language falls to plain text, not one hard-coded case (SPEC §6.2 / §19; resolves the `#17` spike finding). Dogfood `/docs` (incl. `rfc-017-anchoring.mdx` + SPEC's plantuml/mermaid fences) verified still rendering.

## Known debt (accepted deliberately)

- Image re-hosting covers inline markdown images (`![](…)`) — what native markdown and the HTML→markdown pass produce; reference-style image definitions and surviving raw `<img>` tags are not re-hosted (the renderer drops raw HTML anyway). (S)
- SVG re-hosting: a namespaced `xlink:href` remote reference on `<image>` can survive `enshrined/svg-sanitize`'s `removeRemoteReferences` (library quirk), but it is inert when the asset is rendered via `<img src>`; the XSS-critical surface (scripts, handlers, `javascript:`) is always stripped. Revisit if SVGs are ever inlined. (S)

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
