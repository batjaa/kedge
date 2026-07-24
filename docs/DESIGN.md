# Kedge — Design Language

> **Approved 2026-07-03** from the design exploration round (6 variants; "Protocol Rebuild" won).
> **Amended 2026-07-23** — second exploration round (3 variants) locked **"Open Harbor"**: light-first warm register + Space Grotesk display headings. Canonical mockups are now the `docs/designs/app-*.html` set (app surfaces) plus `variant-3-open-harbor.html` (marketing landing); `review-page.html` remains the **anatomy** reference for the review surface.
> Provenance: clean-room rebuild of the Tailwind Plus **Protocol** template aesthetic — studied from the live
> preview, every line of markup written from scratch. **No Tailwind Plus code may ever enter this repo** (AGPL).

## Brand

- **Name**: Kedge /kɛdʒ/ — the anchor a crew carries ahead and re-sets to pull the ship forward; *kedging* = progress by re-anchoring, which is the product's moat (comments that keep their place across versions).
- **Tagline**: "Comments that keep their place." (alt: "Reviews that hold fast.")
- **Wordmark**: lowercase `kedge`, Space Grotesk (display face), semibold, tight tracking.
- **Mark**: minimal line-drawn kedge anchor tilted ~15° forward (motion, not mooring); stroke weight matching panel hairlines; emerald-400 on dark, emerald-600 on light. Anchor-glyph fallback at favicon sizes. (Proper logo pass is a TODO — this is the working direction.)
- **Voice**: editorial-nautical restraint — "anchored / relocated / orphaned", "hold fast", "re-anchor". Never pirate-themed.

## Principles

1. **Light-first, both themes always** (flipped from dark-first 2026-07-23 with Open Harbor). Default to the warm light register — page on `stone-50`, white cards — for the zero-signup "paste a URL" audience; every component still ships light + dark from day one via the `dark:` variant. Dark mode maps back to the original zinc register. Theme toggle in the header.
2. **Panels are the unit of UI.** Anything that isn't prose lives in a `rounded-2xl` panel with a hairline ring — threads, code, diffs, callouts, collapsed rows. One anatomy everywhere: header bar / body / action footer.
3. **Code-things stay dark in light mode.** Code panels and suggestion diffs keep the dark `zinc-900` treatment in both themes (the signature move). Comment prose follows the theme.
4. **Mono chips carry metadata.** Statuses, versions, roles, and section refs render as tiny uppercase mono chips — never colored prose.
5. **System fonts for prose/UI; Space Grotesk for display** (amended 2026-07-23). Headings, wordmark, and page/panel titles use **Space Grotesk** (OFL — self-host the woff2 in `web/`, never a runtime Google Fonts fetch; mockups may use the CDN). Body, UI chrome, and prose stay on `ui-sans-serif/system-ui`; `ui-monospace` for code/chips.
6. **Calm surface, quiet color.** Zinc carries the page; emerald is the only brand accent. Status hues (amber/violet/rose) appear only inside chips, rings, and marks.

## Tokens

### Color

| Role | Light | Dark |
|---|---|---|
| Page background | `stone-50` | `zinc-900` |
| Panel background | `white` | `white/[.03]` |
| Border/ring (hairline) | `zinc-900/10` | `white/10` |
| Divider (soft) | `zinc-900/5` | `white/5` |
| Heading text | `zinc-900` | `white` |
| Body text | `zinc-600` | `zinc-400` |
| Muted/meta text | `zinc-400` | `zinc-500` |
| Brand accent | `emerald-500/600` | `emerald-400` |
| Code panel (both themes) | `zinc-900` + `ring-white/10` | same (`dark:bg-white/[.03]`) |

**Status hues** (chips, rings, marks only): open/success `emerald` · suggestion/pending `amber` · agent `violet` · orphan/danger `rose` · neutral/resolved `zinc`.

### Status chip recipe

`font-mono text-[9-10px] font-semibold uppercase rounded-lg px-1.5 py-0.5 ring-1 ring-inset ring-{hue}-500/30 bg-{hue}-500/10 text-{hue}-700 dark:ring-{hue}-400/30 dark:bg-{hue}-400/10 dark:text-{hue}-400`

### Typography

- Display (headings): **Space Grotesk** (400–700) → system-sans fallback — H1 `text-3xl font-bold tracking-tight`, H2 `text-xl font-semibold`, page/panel titles.
- Sans (body/UI): `ui-sans-serif, system-ui` — body `text-sm/base leading-7`, panel titles `text-xs font-semibold`.
- Mono: `ui-monospace` — chips, inline code (`ring-1 ring-zinc-300 dark:ring-zinc-700 rounded px-1`), code blocks `text-xs leading-relaxed`.

### Shape & elevation

- Panels/cards: `rounded-2xl` (16px). Inner sub-panels (diffs): `rounded-xl`. Chips: `rounded-lg`. Buttons: `rounded-full`.
- Elevation via rings, not shadows: `ring-1 ring-inset`. Shadows only on the code panel (`shadow-md`) and floating mobile pill (`shadow-xl`).

### Buttons

- **Primary**: light `bg-zinc-900 text-white hover:bg-zinc-700`; dark `bg-emerald-400/10 text-emerald-400 ring-1 ring-inset ring-emerald-400/20 hover:bg-emerald-400/15`. Always `rounded-full text-sm font-medium px-3.5 py-1.5`. Hero and approve CTAs may use the solid emerald variant in light: `bg-emerald-600 text-white hover:bg-emerald-500`.
- **Secondary**: `bg-zinc-100 dark:bg-white/5 ring-1 ring-inset ring-zinc-900/10 dark:ring-white/10`.
- **Text actions** (panel footers): `text-xs text-zinc-400/500`, hover → hue of the panel's status.

## Page layout

Use the full viewport width — the docs grid must not reserve space for chrome that isn't there (`--fd-layout-width: 100%`, no phantom TOC column). The review pair (prose + rail) centers in the remaining width: prose column capped at **52rem** (readability measure — full width goes to the pair and its breathing room, never to line length), comment rail **320px** (`360px` at 2xl), gap 40–56px. Below `xl` the rail hides behind the mobile pill and prose keeps its measure.

Both side columns are **collapsible** (added 2026-07-21): the sidebar collapses from a button in its chip row and the rail from a slim `w-12` gutter pinned to the right viewport edge; a collapsed column leaves a slim strip with a `PanelLeft/RightOpen` ghost icon (the rail strip also shows the open-thread count chip and a rose dot when orphans exist). Preferences persist per device (`localStorage`); both columns default to expanded, and activating a thread (highlight click, sidebar nav) re-opens a collapsed rail. Collapsing never widens the prose past 52rem — it buys measure on small screens and breathing room on large ones.

## Component inventory (anatomy per `review-page.html`; Open Harbor restylings across the `app-*` set)

- **Header** — fixed, `h-14`, `bg-white/85 dark:bg-zinc-900/85 backdrop-blur`, hairline bottom border. Logo · ⌘K search pill · nav links · theme toggle · approval avatar stack (stale approvals at `opacity-50` with title tooltip) · primary AI-digest button.
- **Sidebar** — fixed `w-72`, two nav groups on a `border-l` hairline: **Document** (headings; active = `-ml-px border-l-2 border-emerald-500` + heading-color text) and **Threads** (each row: title + right-aligned status chip — the Protocol "method label" idiom). Doc meta chips (`v4`, `IN REVIEW`, source path) at top; Re-sync as secondary button at bottom.
- **Version callout** — `rounded-2xl ring-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5`, info icon, trailing "View diff →" link. Never auto-swap the page.
- **Inline highlights** — `<mark>` with `bg-{hue}-400/15 dark:/10`, `border-b-2 border-{hue}-500/60`, `box-decoration-clone`. Emerald = comment thread, amber = suggestion.
- **Property list** — mono chip + faded type + description, `divide-y` soft dividers. Used for anchor fields; reuse for any schema-ish content.
- **Code panel** — dark in both themes: title bar (name + language tabs, active tab `text-emerald-400 border-b border-emerald-400`) / mono context sub-bar on `bg-zinc-950/40` with an `obj`-style chip / `pre` body. Syntax: keys `emerald-400`, strings `sky-300`, numbers `amber-300`, base `zinc-300`.
- **Thread panel** — header (type + `§ section` mono ref + status chip) / body (avatar `h-5 w-5` initials, name, relative time; replies indented with `border-l-2`) / footer (Reply · Resolve · Fork + right-aligned AI "Draft reply →").
- **Suggestion panel** — same anatomy; body holds a dark `rounded-xl` diff (`- ` line `rose-400/90`, `+ ` line `emerald-400`, `select-none` markers); footer = primary Accept / secondary Decline.
- **Agent thread** — same anatomy with violet ring (`ring-violet-500/20`) + `AGENT · MCP` chip. Agents are visually peers, tinted—not boxed away.
- **Collapsed rows** — resolved threads and the orphan tray as full-width `rounded-2xl` ghost buttons; orphan row uses rose ring/tint + "Re-attach →".
- **Section-approve control** — "Is this section ready to approve?" + segmented Yes/No pill (the Protocol feedback-widget idiom, repurposed).
- **Mobile** — sidebar and rail hidden below `lg`/`xl`; floating bottom pill ("3 open threads") opens the thread sheet.

## Interaction rules

- Hover: text-color shifts and `bg-*/5` tints only — no scale/translate effects. Respect `prefers-reduced-motion` for anything animated.
- Focus: visible `focus-visible:ring-2 ring-emerald-500` on all interactive elements (mockup omits this; implementation must not).
- Highlight contrast in dark mode must keep body text readable through the tint — validated per hue before adding new mark colors.

## Canonical mockups (locked 2026-07-23)

All in `docs/designs/`, cross-linked as a click-through prototype; every page has the light/dark toggle.

- `variant-3-open-harbor.html` — marketing landing: hero, capability tour, workspace console, roadmap cards, self-host CTA
- `app-dashboard.html` — workspace home: import box on top (M3.5), projects rail + Unfiled, filterable docs table with live import states, activity feed, M5 queue ghost
- `app-project.html` — project page (M3.6): tracked sources with scan report + flagged deletions (never auto-delete), add-source → preview → bulk import, project doc list
- `app-document.html` — the review surface in the Open Harbor register (layout/anatomy unchanged from `review-page.html`)
- `app-versions.html` — version timeline (incl. an ADR-0001 PR-candidate entry), diff with comment overlay, version-pinned approvals with staleness
- `app-workspace.html` — workspace settings: PAT connector (shipped), MCP agent tokens (M4 ghost), M6 connector + members ghosts
- `app-teams.html` — **post-v1 design preview** of account → workspace → teams/members (hierarchy note: SPEC §10.1); not v1 scope

## Implementation notes

- Target: Next.js + Tailwind v4 + Fumadocs shell restyled to these tokens (see SPEC §4.1; spike pending). Express tokens as Tailwind theme variables so both editions/themes stay in sync.
