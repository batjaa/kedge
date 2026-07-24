# AGENTS.md — Kedge

Onboarding for AI agents (and humans) working in this repo. Keep this file current: when a rule or decision here changes, update it in the same commit.

## What this project is

**Kedge** is an open-source (AGPL-3.0) spec-review platform: paste a link to an RFC/spec wherever it lives (GitHub, Confluence, raw URL, `.md`/`.mdx`/`.html`), get a beautifully rendered page with anchored comment threads, suggested edits, version-pinned approvals, and AI review tooling. The moat: comments survive document versions (re-anchoring), and **AI agents are first-class reviewers** via MCP. Runs as a SaaS and fully self-hosted (`docker compose up`).

## Read first, in this order

1. **`docs/SPEC.md`** — product & engineering source of truth. Every scope/architecture decision lives here with rationale. If your work changes a decision, amend the spec in the same commit.
2. **`docs/DESIGN.md`** — approved design language (tokens, component anatomy, hard UI rules). Canonical mockup: `docs/designs/review-page.html`.
3. **`docs/TODOS.md`** — decision log, open spikes, debt registry. Check before starting; update when you finish, defer, or discover work.

## Repo layout

```
kedge/
├── api/      # Laravel 13 backend — NOT YET SCAFFOLDED (arrives at M0)
├── web/      # Next.js + Fumadocs reading surface — real code, spike-stage
├── deploy/   # docker-compose reference deployment — arrives at M7
├── docs/     # spec, design language, todos, approved mockup
└── LICENSE   # AGPL-3.0
```

## Current state (last updated 2026-07-09)

Pre-M0. Completed: spec reviewed (Rev 3), design approved, repo initialized, two spikes validated (Fumadocs MDX rendering + review-rail layout; Kroki sole-engine diagrams), product named Kedge (2026-07-09; domains kedge.review/kedge.ink, org kedgehq). Open P1: hypothes.is anchoring port spike. Milestone plan: SPEC §21.

## Working in `web/`

- `npm run dev` → http://localhost:3000 · `npm run types:check` before finalizing TS changes.
- Stack: Next 16, Fumadocs 16, Tailwind v4. Content lives in `web/content/docs/` — dogfood copies of `../docs/*.md` (plus fixtures like `rfc-017-anchoring.mdx`). **If you change `docs/*.md`, refresh the copies** (frontmatter added on top, first `# ` heading dropped).
- Theming is done ONLY via `--color-fd-*` variable overrides in `app/global.css`, mapped from DESIGN.md tokens. Never fork Fumadocs components to restyle. **Fonts**: the display face (headings/wordmark/panel titles) is self-hosted **Space Grotesk** via the `--font-display` token (Open Harbor, DESIGN.md amended 2026-07-23) — woff2 + OFL in `web/public/fonts/`, served same-origin, never a runtime Google Fonts fetch. Body/UI/prose stay on system stacks; add no other webfonts.
- Diagrams: fenced code blocks on the Kroki engine allowlist (`lib/remark-diagrams.ts`) become `<KrokiDiagram/>` (server-rendered, cached). Unknown fence languages must fall through to plain-text highlighting.
- MDX behaving oddly after config/schema/content changes → `rm -rf .next .source` and restart the dev server (stale compiled MDX cache).

## Working in `api/` (once it exists)

Laravel 13 per SPEC §4.1: PHPUnit (never Pest) · `vendor/bin/pint --dirty` before finalizing · authorization via Policies on every resource route (no inline ownership checks) · backed enums for fixed-value columns · business logic in `app/Services/` · `php artisan make:*` for new files.

## Hard rules (violations are never acceptable)

1. **This is a public AGPL repo.** No proprietary code — in particular, **never copy Tailwind Plus / Protocol template code**. The design is a clean-room rebuild; DESIGN.md and the mockup are the only design sources. No secrets, keys, or tokens in any commit.
2. **Rendering never crashes on untrusted input.** Unknown fence langs → plain text; MDX compile failure → plain-markdown fallback + banner; diagram render failure → show-source error panel. Imported documents are untrusted (MDX is code): imports/exports rejected, components allowlisted.
3. **Kroki is the sole diagram engine** (SPEC §6.2), self-hosted in both editions; only the explicit engine allowlist is ever forwarded to it.
4. **Nova is SaaS-ops tooling** — it must never become a runtime dependency of the open-source app.
5. **AI output is always a human-confirmed draft.** No AI feature auto-posts or has side effects. Document/comment content is untrusted input to prompts (injection channel).
6. Comment persistence must never depend on notification fan-out succeeding.

## Conventions

- **Conventional Commits**, imperative, scoped: `feat(web): …`, `fix(api): …`, `docs: …`. Commit per logical unit.
- **Module specs** live in `docs/specs/` named `<milestone>-<module>.md` (`m0-scaffold.md`, `m2-comments-suggestions.md`).
- **Verify before moving on**: run the dev server / tests and confirm the change actually works; smoke-test affected routes.
- **Decisions are recorded**, not just made: scope/architecture changes go into SPEC.md (with rationale) and the TODOS.md decision log in the same commit as the code.
- Diagrams inside `docs/` are PlantUML/Mermaid fenced blocks — the product renders them itself (dogfooding).
- Dates in docs are absolute (`2026-07-03`), never relative.

## Dogfooding principle

Kedge reviews its own documents in its own tool. When you add product capability, prefer demonstrating it on Kedge's real docs (`web/content/docs/`) over synthetic examples — spikes here have repeatedly caught real bugs that fixtures wouldn't (e.g., SPEC.md's `plantuml` fences crashing Shiki).
