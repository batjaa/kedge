# Spec: Import & render

> Module M1 on `docs/ROADMAP.md` (charted 2026-07-10). Scope source: SPEC §21 M1; ingestion SPEC §5; rendering SPEC §6; sharing & demo SPEC §10; security SPEC §13. Specced 2026-07-11.

## Problem Statement

An author with an RFC in a public repo, on a static site, or in a private GitHub repo has no way to get it into Kedge: the product renders only its own dogfood docs checked into the repo. There is no import, no document identity, no way to hand a reviewer a link — and a stranger who hears about Kedge has no way to try it short of cloning the repo. Everything the roadmap promises (comments, versions, approvals, AI review) presupposes a document that was imported, normalized, and rendered — none of which exists.

## Solution

Paste a link — public GitHub file, raw `.md`/`.mdx`/`.html` URL — or upload/paste content, or connect a private GitHub repo with a PAT, and Kedge imports the document in the background, normalizes it to markdown/MDX (with an honest warning list for anything that didn't survive), and renders it beautifully: TOC, dark mode, code highlighting, and ~20 diagram engines as live SVG. The author shares it with an unguessable revocable link. On the SaaS, an anonymous stranger pastes a public URL and gets the rendered doc with zero signup — and can claim it into a real account before it expires. Hostile input never crashes a page: bad MDX degrades to plain markdown with a banner, unknown fence languages render as plain code, a failed diagram shows its source.

## User Stories

1. As an author, I want to paste a public GitHub file URL (blob link) and get a rendered doc, so that my RFC in a public repo becomes reviewable with no setup.
2. As an author, I want to paste a raw URL to a `.md`/`.mdx`/`.html` file, so that specs hosted anywhere — gists, static sites, internal servers — can be imported.
3. As an author, I want to upload or paste document content directly, so that a local draft is reviewable before it lives anywhere.
4. As an author, I want to connect GitHub with a PAT (stored per-workspace, encrypted) and import files from private repos, so that private specs are reviewable; as a self-hoster, this is my primary private-source path (permanent connector, SPEC Rev 3).
5. As an author, I want import to accept immediately and show progress (importing → ready / failed), so that a slow source never blocks the UI.
6. As an author, I want a failed import to tell me why and offer retry, so that a flaky source or rate limit doesn't dead-end.
7. As an author, I want an import warning list on the doc — failed image fetches, degraded MDX, dropped constructs — so that I know exactly what didn't survive normalization, never silently.
8. As an author, I want imported docs to get a sensible title without hand-editing frontmatter, so that a bare markdown file still shows up properly in the UI (spike finding, TODOS 2026-07-03).
9. As a reader, I want the doc rendered to the approved design — sidebar nav from headings, sticky TOC, dark mode, Shiki code highlighting — so that reading a spec in Kedge beats reading it on GitHub.
10. As a reader, I want fenced diagram blocks (`plantuml`, `mermaid`, `excalidraw`, `d2`, `graphviz`, … the full Kroki allowlist) rendered as live SVG with click-to-zoom, so that complex diagrams are legible.
11. As a reader, I want a diagram that fails to render to show its raw source with an error chip, so that a Kroki hiccup never breaks the page.
12. As a reader, I want unknown fence languages highlighted as plain text, so that an exotic code block never crashes rendering (replaces the spike's `langAlias` workaround).
13. As a reader, I want a hostile document (MDX with imports/expressions, script-bearing HTML) rendered safely — degraded with a banner where needed — so that opening a shared doc is never dangerous.
14. As an author, I want to create a share link for a doc, so that reviewers can read it without accounts.
15. As an author, I want to revoke a share link or give it an expiry, and I want dead links to land on a friendly named page, so that access is controllable and mistakes aren't scary.
16. As a share-link visitor, I want the page excluded from search indexing, so that a "private link" stays effectively private.
17. As an anonymous visitor on kedge.review, I want to paste a public URL and see the rendered doc in seconds with zero signup, so that trying Kedge costs nothing (the PLG wedge).
18. As that visitor, I want to claim the demo doc by signing up — moving it into my new workspace before its 48h expiry — so that trying converts to owning without re-importing.
19. As a self-hoster, I want demo mode absent entirely on my instance (`SELF_HOSTED=true`), so that I don't run a public abuse surface.
20. As a security reviewer, I want every fetch (import and demo) SSRF-guarded, so that the importer can't probe private networks; blocked URLs get a clear "URL not allowed" message.
21. As a workspace member, I want documents, shares, and integrations reachable only within my workspace (Policies everywhere), so that an ID in a URL is never an access path.
22. As an operator, I want named import/render events and an import success-rate metric, so that a broken connector is visible before users report it.
23. As a future reviewer (M2), I want every imported version to carry its plain-text projection, so that comment anchors have their substrate from the very first version.

## Implementation Decisions

**Builds on the Scaffold module** (auth, workspaces, Policies convention, `/api/v1`, `SELF_HOSTED` flag) — implementation starts after M0 lands.

**Schema (M1 slice of SPEC §16).** `documents`, `document_versions`, `shares`, `integrations` with the enums they need (`DocumentStatus`, `LifecycleStatus`, `SyncStatus`, share visibility). `documents` = stable identity, `document_versions` = immutable snapshots; M1 produces exactly one version per document (re-sync is M3), but the two-table shape, `(document_id, content_hash)` uniqueness, and `current_version_id` exist now so M3 adds versions without migration surgery. `lifecycle_status` exists with default `draft`; its UI is M3. PAT credentials live in `integrations.credentials` as encrypted casts — never serialized into responses, scrubbed from logs (SPEC §13).

**Import flow (SPEC §5.3).** `POST /api/v1/documents {url | content}` matches a connector, policy-checks, creates the document as `importing`, dispatches a queued import job (`ShouldBeUnique` per document), returns 202; the web polls `GET /documents/{id}`. The job fetches, normalizes, re-hosts images, obtains the projection, and creates the version. Failure paths follow the SPEC §19 registry: retry ×3 with backoff → `failed` + retry CTA; GitHub 403/429 honors Retry-After; conversion errors degrade rather than fail.

**Connectors.** The `Connector` interface from SPEC §5.1, with four v1 implementations: GitHub public file (blob URL → contents API, unauthenticated), raw URL, upload/paste (size-capped, manual-only versioning), GitHub PAT (per-workspace `integrations` row). GitHub App and Confluence are M6; the interface already carries their seams (`webhookSupported`, `postComment` as no-ops).

**Normalization (SPEC §5.2).** `.md` stored as-is; `.mdx` validated at import via the projection call (below) — rejection or compile failure marks the version for plain-markdown fallback rendering with an author-visible banner and a `mdx.compile_failed` log event; `.html` sanitized then converted with `league/html-to-markdown`. Referenced images are fetched, re-hosted to `MEDIA_DISK` (R2 on SaaS, local disk self-host), and URLs rewritten; every failed fetch is an import warning, never silent; SVG assets sanitized. Warnings persist on the document and render as the author-facing warning list. `content_hash = sha256(normalized content)`. Title/description frontmatter is synthesized at import when absent (first `# ` heading, else source filename).

**Projection service (SPEC §5.4).** The web layer owns the plain-text projection. The import job calls one internal web endpoint: normalized content in → `{ plain_text, projection_version, mdx_ok, warnings }` out — the same remark/rehype pipeline that renders is the one that projects and the one that validates MDX, so there is exactly one definition of "what this document is". Non-text blocks (diagrams, images, MDX components) become stable placeholder tokens. `plain_text` and `projection_version` are stored on the version; nothing consumes them until M2 — this module's job is to make the substrate exist and be conformance-tested.

**Rendering (SPEC §6).** Imported docs render through a dynamic web route fed from the API (server components via the BFF pattern), reusing the spike-validated Fumadocs shell, design tokens, and MDX component set — the filesystem dogfood content stays as-is alongside. MDX compiled with `@mdx-js/mdx` in the web server layer, artifact cached by `content_hash` (compile once per version, not per request). A remark plugin rejects `import`/`export` and non-literal expressions; JSX resolves only from the allowlist (`Callout`/`Note`/`Warning`/`CodeGroup`/`Tabs` + `KrokiDiagram`); unknown components render a neutral "unsupported component" box; raw HTML passes rehype-sanitize; compile failure → plain-markdown fallback + banner. Unknown fence languages fall through to plain-text highlighting — this is where the spike's `langAlias` workaround is deleted in favor of the real fallback.

**Diagrams (SPEC §6.2).** Kroki stays the sole engine with the explicit allowlist (the spike's `remark-diagrams` list is the canonical one). New at M1, per the architecture: the API mediates Kroki — it renders once per `(engine, source_hash)` and caches the SVG on `MEDIA_DISK`; the web's diagram component fetches the cached SVG from the API instead of contacting Kroki directly (the spike's per-build Next fetch cache is not shared and gets replaced). SVG embedded with no script surface. States: loading skeleton, never-crash show-source error panel, click-to-zoom (spike finding: genuinely needed). `KROKI_URL` is env-driven; hosted kroki.io is acceptable in local dev only — the self-hosted container becomes real with the deploy surfaces (SaaS droplet at Launch, compose at M7).

**Share links (SPEC §10.2).** Unguessable 32+-char tokens, constant-time lookup, optional expiry, revocable, `noindex`; revoked/expired tokens land on a friendly named page, not a bare 403. M1 ships the `link` visibility mode only — `email_restricted` and `workspace` need M2's magic-link identity. The share read surface is a public web route resolving the token through the API, read-only.

**Instant demo mode (SPEC §10.3, SaaS-only).** `SELF_HOSTED=true` removes the endpoints entirely. Unauthenticated `POST /demo/documents {url}`: public connectors only (GitHub public + raw URL), aggressive per-IP rate limits, size caps, full SSRF guarding. Demo docs live in a reserved system workspace with `expires_at = now + 48h`; a scheduled command prunes expired ones. The rendered demo page carries the "Claim this doc" CTA; `POST /documents/{id}/claim` moves the doc into the claiming user's workspace. Initial rate-limit numbers are config, tuned at Launch (ROADMAP "Not yet specified"). The anonymous SaaS home page is the paste box; self-hosted home is sign-in.

**SSRF guard (SPEC §13).** One shared guard for all fetching (import + demo + images): https-only scheme allowlist, DNS resolve-then-pin, private/reserved ranges blocked including redirect hops, size and timeout caps. Blocked fetches log `ssrf.blocked` and surface "URL not allowed (private address)".

**Observability (SPEC §19).** Named events from day one of this module: `import.started/completed/failed{connector,duration,bytes}`, `mdx.compile_failed`, `kroki.render_failed`, `ssrf.blocked`, `demo.created/claimed/pruned`. Import success rate is the module's health metric. **Web-side error reporting: deferred to Launch** (decided 2026-07-11, resolving SPEC §22.4) — demo mode is SaaS-only and the SaaS has no public traffic until Launch; whatever lands must be off/optional in self-host builds.

**Rate limiting (SPEC §13).** Import and demo endpoints rate-limited from the start, alongside the auth limits M0 established.

## Testing Decisions

Three seams, agreed 2026-07-10:

1. **API HTTP seam (PHPUnit feature tests)** — extends M0's house pattern. The import lifecycle over the API (202 → poll → ready/failed), connector selection, normalization outcomes and warnings as observable API state, content-hash dedupe, share-link create/revoke/expiry/read, demo mode (rate limits, TTL + prune, claim, `SELF_HOSTED` gate), the SSRF suite (private ranges, redirect hops, rebinding pin), and the IDOR-matrix extension across the new resources (documents, shares, integrations, claim). External sources are faked at the HTTP boundary with recorded fixtures (SPEC §18.5 connector contract tests, including rate-limit and token-revoked paths); the web projection endpoint is faked at its HTTP boundary.
2. **Web rendering-pipeline fixture seam (Vitest — new).** Golden projection conformance corpus (document in → expected `plain_text` + placeholder tokens; SPEC §5.4/§18.2) — rendering-pipeline upgrades that change projections fail CI until intentional — plus the MDX adversarial suite (SPEC §18.3): import/export smuggling, expression payloads, script-in-HTML, unknown components → neutral box, compile failure → fallback, unknown fence languages → plain text. Tests run against the pipeline functions directly on a fixture corpus; per the dogfooding principle, Kedge's own docs (SPEC.md with its PlantUML fences already broke Shiki once) seed the corpus alongside adversarial fixtures.
3. **A Playwright journey PACK** — the browser seam, grown from one journey to a pack once the surfaces shipped (`#39`, 2026-07-14 review — see the TODOS "E2E journey pack" decision log). The M1 demo criterion is still the spine: paste a public URL anonymously → rendered doc with a live diagram → share link opens in a second context → signing up claims the doc. Around it, one spec per shipped import-render surface: `import-url` / `import-paste` (URL and pasted-content happy paths), `import-failure` (SSRF-blocked → friendly message + retry CTA; transient 500 → friendly inline error), `import-warnings` (HTML with a broken image → ready doc + amber warning panel + re-hosted image), `mdx-safety` (allowlisted component renders, unknown → neutral box, smuggled import → plain-markdown fallback + banner, injected script absent from the DOM), `diagrams` (mermaid fence → decoded `/storage` SVG, unknown fence → one contiguous `<pre>`, click-to-zoom + ESC), `share-lifecycle` (create with expiry → read-only in a fresh cookie-less context with `noindex` → revoke → friendly gone page), and `settings-pat` (connect a fake PAT → masked listing → remove → empty state). Conventions: every spec registers its own unique user and creates its own documents (worker-safe; `workers: 1` is a scope choice, proven green at `--workers=4`); every source is a deterministic loopback fixture (`web/e2e/fixtures.ts`, `serve-fixtures.mjs`), never a live URL; the E2E env adds `CACHE_STORE=array` so cache-backed rate limiters don't couple independent journeys. **The one specced journey NOT reproduced is "transient failure → retry → succeeds"**: the E2E queue is `sync`, so a transient import failure rethrows out of the synchronous dispatch as a 500 and never reaches a document page with a retry CTA — that flip needs production's async queue and stays covered by the API feature tests (see the decision log for the full rationale).

Good tests here assert external behavior: what the API returns, what the page renders, what survives in the database — never job internals or pipeline intermediates. Prior art: M0's feature-test and Playwright conventions; the Vitest seam is new and becomes the prior art for every future rendering-pipeline change.

## Out of Scope

- **Comments, threads, anchors, magic-link identity** — M2. The projection is produced and stored here but nothing reads it yet.
- **`email_restricted` / `workspace` share modes, anonymous-commenting toggle** — need M2 identity; `link` mode only at M1.
- **Re-sync, versions UI, diff, re-anchoring** — M3. One version per document at M1; the schema shape for more exists.
- **Lifecycle status UI and approvals** — M3 (column exists, default `draft`).
- **GitHub App, Confluence connector, digest post-back** — M6. The `Connector` interface carries their seams as no-ops.
- **Deploy artifacts** — Kroki container on the SaaS droplet is Launch bootstrap; compose bundling is M7. M1's obligation is `KROKI_URL` env-pluggability and the allowlist.
- **Demo-mode abuse thresholds** — shipped as config with sane initial values; real numbers tuned at Launch (ROADMAP "Not yet specified").
- **Web-side error reporting** — deferred to Launch (decision recorded above).
- **Generic git connector (GitLab/Bitbucket)** — deferred (TODOS).

## Further Notes

- Demo criterion (SPEC §21 M1): *a stranger pastes a URL and gets a beautiful doc with zero signup.* ✅
- Spike findings absorbed here: never-crash fence fallback (replaces `langAlias`), frontmatter synthesis at import, click-to-zoom, shared hash-keyed SVG cache (Next fetch cache is per-build).
- The projection endpoint is internal (web ← queue job); it must not be reachable from the public internet on the SaaS topology — an implementation detail the tickets should carry.
- Accepted-debt reminder (TODOS): TS/PHP type duplication across the API boundary continues hand-written at M1; OpenAPI codegen later.
