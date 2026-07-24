import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { gitConfig } from '@/lib/shared';
import { LandingHeroForm } from './landing-hero-form';

// The anonymous SaaS home: the Open Harbor marketing landing (SPEC m3.8, #109).
// A stranger's first impression of Kedge — hero with the working paste-a-URL
// demo (LandingHeroForm reuses the unchanged demo flow), a capability tour, a
// static workspace console shot, the roadmap, and the self-host story. Rendered
// only on the SaaS edition for an anonymous visitor; app/page.tsx keeps the
// self-hosted sign-in branch ahead of this. Design of record:
// docs/designs/variant-3-open-harbor.html — DESIGN.md tokens, no webfonts (the
// display face is self-hosted Space Grotesk via --font-display / the heading
// rule), both themes, fully responsive.
//
// All copy here is statically authored marketing content — hand-curated, never
// generated from ROADMAP.md (SPEC m3.8 Out of Scope). Strings are grouped as
// section data so M3.9 can localize them without restructuring; no i18n plumbing
// is added here (that is M3.9). The product illustrations are honest static
// content: their action affordances are non-interactive by design.

const NAV_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#workspace', label: 'Workspace' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#self-host', label: 'Self-host' },
];

const STEPS = [
  {
    title: 'Import from anywhere',
    body: 'A GitHub file, a whole repo directory, a raw URL, an upload. Diagrams render, broken markup never crashes the page, and a share link exists in seconds.',
  },
  {
    title: 'Discuss on the text itself',
    body: 'Select a sentence, start a thread. Propose the fix as a suggested edit the author accepts in one click. Reviewers join by magic link — no accounts to herd.',
  },
  {
    title: 'Ship a new version, keep the review',
    body: 'Re-sync pulls the latest doc. Comments re-anchor — exact, then fuzzy, then safely into the orphan tray. Approvals show exactly which version they vouch for.',
  },
];

const WORKSPACE_POINTS = [
  'Live import status on every doc, retry inline',
  'Lifecycle, open threads, and sync state at a glance',
  'An Unfiled bucket, so nothing needs a home first',
];

type Phase = 'shipped' | 'building' | 'charted' | 'launch';

const ROADMAP: {
  phase: Phase;
  when: string;
  title: string;
  body: string;
  badge?: string;
}[] = [
  {
    phase: 'shipped',
    when: 'M0–M1 · July 12–15',
    title: 'Import & render',
    body: 'GitHub, raw URL, upload, PAT for private repos. Kroki diagrams, MDX safety net, share links, instant demo mode.',
  },
  {
    phase: 'shipped',
    when: 'M2 · July 16',
    title: 'Comments & suggestions',
    body: 'Anchored threads, replies, resolve, fork. Suggested edits with one-click accept. Magic-link reviewers.',
  },
  {
    phase: 'shipped',
    when: 'M3 · July 20',
    title: 'Versions & approvals',
    body: 'The re-anchoring ladder ships: exact → fuzzy → orphan tray. Diff view with comment overlay; version-pinned approvals with staleness.',
  },
  {
    phase: 'shipped',
    when: 'M3.5–3.6 · July 21',
    title: 'Workspace',
    body: 'The live documents list, projects as free containers, and tracked repos: point at a folder, bulk import, re-scan on demand.',
  },
  {
    phase: 'building',
    when: 'M4 · building now',
    title: 'AI & agents',
    body: 'Review digests, drafted replies, improve-prompts — always human-confirmed. And the MCP server: AI agents as badged, first-class reviewers.',
    badge: 'Agent · MCP',
  },
  {
    phase: 'charted',
    when: 'M5 · charted',
    title: 'Inbox & review queue',
    body: 'Mentions, email you actually want, and one dashboard for “what needs my review?”',
  },
  {
    phase: 'charted',
    when: 'M6 · charted',
    title: 'Private sources',
    body: 'GitHub App: push → the doc re-syncs itself. Confluence import. Digests posted back to the PR.',
  },
  {
    phase: 'charted',
    when: 'M7 · charted',
    title: 'Self-host',
    body: 'docker compose up on a fresh VM → a full private instance. Nothing leaves your network.',
  },
  {
    phase: 'launch',
    when: 'Launch',
    title: 'kedge.review goes live',
    body: 'Both editions at once — the SaaS for anyone with a URL, the compose file for teams who keep their specs at home.',
  },
];

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

// Shared link styling for the header/footer nav and CTAs.
const NAV_LINK = 'rounded-md hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-white';

export function Landing() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-600 antialiased dark:bg-zinc-900 dark:text-zinc-400">
      <LandingHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Workspace />
        <Roadmap />
        <AgentsTeaser />
        <SelfHostCta />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-900/10 bg-stone-50/85 backdrop-blur dark:border-white/10 dark:bg-zinc-900/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
        <BrandMark />
        <nav
          aria-label="Primary"
          className="ml-auto hidden items-center gap-7 text-sm font-medium text-zinc-600 md:flex dark:text-zinc-400"
        >
          {NAV_LINKS.map((item) => (
            <a key={item.href} href={item.href} className={NAV_LINK}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <ThemeToggle />
          <Link
            href="/signin"
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="overflow-hidden px-6 pt-32 pb-20" aria-labelledby="hero-heading">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600/10 px-3 py-1 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:ring-emerald-400/30">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Open source · AGPL-3.0 · self-hostable
            </span>
          </div>
          <h1
            id="hero-heading"
            className="mt-6 font-display text-5xl leading-[1.02] font-bold tracking-tight text-zinc-900 sm:text-6xl dark:text-white"
          >
            Paste a link.
            <br />
            Review a spec.
            <br />
            <span className="text-emerald-600 dark:text-emerald-400">Zero signup.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7">
            Kedge renders your RFC from wherever it lives — GitHub, Confluence, any
            URL — with comment threads anchored to the text. Change the doc,
            re-sync, and the comments keep their place.
          </p>
          <LandingHeroForm />
        </div>

        <HeroIllustration />
      </div>
    </section>
  );
}

// Decorative product illustration — the review surface as a static still. Hidden
// from assistive tech (the hero copy + form carry the message); its buttons are
// non-interactive by design, so nothing here is a dead control in the a11y tree.
function HeroIllustration() {
  return (
    <div className="relative" aria-hidden="true">
      <div className="rounded-3xl bg-white p-5 shadow-lg shadow-zinc-900/5 ring-1 ring-zinc-900/10 lg:rotate-1 dark:bg-white/[.03] dark:ring-white/10">
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
          Approvals are pinned to the version reviewed, and{' '}
          <mark className="box-decoration-clone border-b-2 border-emerald-600/60 bg-emerald-500/15 px-0.5 text-zinc-800 dark:border-emerald-500/60 dark:bg-emerald-400/10 dark:text-zinc-200">
            go visibly stale when the document moves on
          </mark>{' '}
          — no silent rubber stamps.
        </p>
        <div className="mt-4 rounded-2xl bg-stone-50 p-4 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">§ 9.2</span>
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Staleness rules</span>
            <span className="ml-auto rounded-lg bg-emerald-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-600/30 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/30">
              Open
            </span>
          </div>
          <div className="mt-3 flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[9px] text-white">SC</span>
            <p className="text-xs leading-5">Love this — can a stale approver re-approve in one click from the diff?</p>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="font-medium">Reply</span>
            <span>Resolve</span>
            <span className="ml-auto font-medium text-emerald-700 dark:text-emerald-400">Draft reply →</span>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-3xl bg-white p-5 shadow-lg shadow-zinc-900/5 ring-1 ring-zinc-900/10 lg:-mt-2 lg:ml-14 lg:-rotate-1 dark:bg-white/[.03] dark:ring-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Suggested edit</span>
          <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30">
            Pending
          </span>
          <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">rfc-017 · v6</span>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl bg-zinc-900 p-3.5 font-mono text-xs ring-1 ring-inset ring-white/10 dark:bg-zinc-950/60">
          <div className="text-rose-400/90">
            <span className="mr-2 select-none">-</span>anchors are stored as character offsets
          </div>
          <div className="text-emerald-400">
            <span className="mr-2 select-none">+</span>anchors store quote + prefix + suffix context
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20">
            Accept
          </span>
          <span className="rounded-full bg-stone-100 px-4 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            Decline
          </span>
        </div>
      </div>

      <div className="absolute -bottom-6 -left-6 hidden items-center gap-2 rounded-full bg-white px-4 py-2 shadow-md ring-1 ring-zinc-900/10 lg:flex dark:bg-zinc-900 dark:ring-white/15">
        <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">14 comments survived the last re-sync</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-heading"
      className="scroll-mt-16 border-y border-zinc-900/5 bg-white px-6 py-20 dark:border-white/5 dark:bg-white/[.02]"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-xl">
          <h2 id="how-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            Review where the doc is readable, not where it&rsquo;s stored
          </h2>
          <p className="mt-4 text-sm leading-7">
            Docs live in repos and wikis; reviews die in PR comments on raw
            markdown. Kedge gives the conversation a surface built for reading —
            and keeps it alive across versions.
          </p>
        </div>
        <ol className="mt-12 grid list-none gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-3xl bg-stone-50 p-6 ring-1 ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/10">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/10 font-display text-sm font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
              >
                {i + 1}
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-zinc-900 dark:text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Workspace() {
  return (
    <section id="workspace" aria-labelledby="workspace-heading" className="scroll-mt-16 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
            New — projects &amp; tracked repos
          </span>
          <h2 id="workspace-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Point it at your{' '}
            <span className="align-middle font-mono text-2xl text-emerald-700 dark:text-emerald-400">docs/</span>{' '}
            folder and let it fill itself
          </h2>
          <p className="mt-4 text-sm leading-7">
            A project tracks a repo, a branch, and a path pattern. Kedge previews
            the matches, bulk-imports them, and a re-scan after each push imports
            new files, re-syncs changed ones, and flags deletions — never deleting
            anything itself.
          </p>
        </div>
        <ul className="mt-6 grid max-w-4xl list-none gap-3 text-sm sm:grid-cols-3">
          {WORKSPACE_POINTS.map((point) => (
            <li key={point} className="flex gap-3">
              <CheckIcon />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <WorkspaceConsole />
      </div>
    </section>
  );
}

// A static console still — an honest illustration of the workspace surface, not a
// live embed. No interactive controls; the "Re-scan" / "Retry" affordances are
// styled text, deliberately inert.
function WorkspaceConsole() {
  return (
    <div className="mt-10 overflow-hidden rounded-3xl bg-white shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
      <div className="flex items-center gap-1.5 border-b border-zinc-900/5 bg-stone-50 px-4 py-2.5 dark:border-white/10 dark:bg-zinc-950/40">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
        <span className="mx-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">kedge.review/workspace</span>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-4">
          <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-inset ring-emerald-600/30 dark:bg-white/[.03] dark:ring-emerald-500/20">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">Kedge v1</span>
              <span className="ml-auto rounded-lg bg-emerald-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-600/30 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/30">
                Active
              </span>
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">⎇ kedgehq/kedge · main · docs/**/*.md</div>
            <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              <span>6 docs</span>
              <span>11 open</span>
              <span className="text-rose-600 dark:text-rose-400">1 orphan</span>
              <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 uppercase text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
                Re-scan
              </span>
            </div>
          </div>
          <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-inset ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Platform RFCs</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">3 docs</span>
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-600">⎇ kedgehq/platform · main · rfcs/*.md</div>
          </div>
          <div className="rounded-2xl border border-dashed border-zinc-900/15 p-4 dark:border-white/15">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Unfiled</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">2 docs</span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">drag docs here… or anywhere</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-zinc-900/5 lg:col-span-8 dark:ring-white/10">
          <div className="flex items-center gap-2 border-b border-zinc-900/5 bg-stone-50 px-4 py-2 font-mono text-[10px] tracking-wider text-zinc-400 uppercase dark:border-white/10 dark:bg-zinc-950/40 dark:text-zinc-500">
            <span>Document</span>
            <span className="ml-auto hidden sm:inline">Lifecycle · Threads · Sync</span>
          </div>
          <div className="divide-y divide-zinc-900/5 dark:divide-white/5">
            <ConsoleRow name="SPEC.md" chip="In review" hue="amber" meta="v4 · 7 open · 2 h ago" />
            <ConsoleRow name="DESIGN.md" chip="Approved" hue="emerald" meta="v2 · 0 open · 2 h ago" />
            <ConsoleRow name="rfc-017-anchoring.mdx" chip="1 orphan" hue="rose" meta="v6 · 3 open · 40 min ago" />
            <ConsoleRow name="specs/m4-ai-agents.md" chip="Importing…" hue="sky" meta="found by re-scan · just now" />
            <ConsoleRow name="ROADMAP.md" chip="Approved" hue="emerald" meta="v3 · 1 open · 2 h ago" />
            <ConsoleRow name="legacy-import.html" chip="Failed" hue="rose" meta="unreachable · 1 d ago" retry />
          </div>
        </div>
      </div>
    </div>
  );
}

const HUE_CHIP: Record<string, string> = {
  amber:
    'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30',
  emerald:
    'bg-emerald-600/10 text-emerald-700 ring-emerald-600/30 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/30',
  rose:
    'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/30',
  sky:
    'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:bg-sky-400/10 dark:text-sky-400 dark:ring-sky-400/30',
};

function ConsoleRow({
  name,
  chip,
  hue,
  meta,
  retry,
}: {
  name: string;
  chip: string;
  hue: keyof typeof HUE_CHIP;
  meta: string;
  retry?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{name}</span>
      <span className={`rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ${HUE_CHIP[hue]}`}>
        {chip}
      </span>
      {retry ? (
        <span className="font-mono text-[10px] text-zinc-500 uppercase underline decoration-zinc-300 dark:text-zinc-400 dark:decoration-zinc-700">
          Retry
        </span>
      ) : null}
      <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{meta}</span>
    </div>
  );
}

function Roadmap() {
  return (
    <section
      id="roadmap"
      aria-labelledby="roadmap-heading"
      className="scroll-mt-16 border-y border-zinc-900/5 bg-white py-20 dark:border-white/5 dark:bg-white/[.02]"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h2 id="roadmap-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
              The harbor chart
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-7">
              Six milestones shipped in July. Every one ends demoable — and Kedge
              reviews its own docs with each new capability the week it lands.
            </p>
          </div>
          <ul className="ml-auto hidden list-none items-center gap-4 text-xs text-zinc-400 sm:flex dark:text-zinc-500">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              Shipped
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400" />
              Building
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white ring-1 ring-inset ring-zinc-300 dark:bg-transparent dark:ring-white/25" />
              Charted
            </li>
          </ul>
        </div>
      </div>
      <div className="mt-10 overflow-x-auto pb-4">
        <div className="flex w-max gap-4 px-6 lg:px-[max(1.5rem,calc((100vw-72rem)/2))]">
          {ROADMAP.map((m) => (
            <RoadmapCard key={m.title} milestone={m} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RoadmapCard({ milestone }: { milestone: (typeof ROADMAP)[number] }) {
  const { phase, when, title, body, badge } = milestone;

  if (phase === 'launch') {
    return (
      <article className="w-64 shrink-0 rounded-3xl bg-emerald-600 p-5 text-white dark:bg-emerald-500/90">
        <div className="flex items-center gap-2">
          <AnchorGlyph className="h-4 w-4 rotate-[15deg]" />
          <span className="font-mono text-[10px] tracking-wider text-emerald-100 uppercase">{when}</span>
        </div>
        <h3 className="mt-3 font-display text-base font-semibold">{title}</h3>
        <p className="mt-2 text-xs leading-5 text-emerald-50">{body}</p>
      </article>
    );
  }

  const surface =
    phase === 'building'
      ? 'bg-violet-50 ring-violet-600/20 dark:bg-violet-400/[.06] dark:ring-violet-500/20'
      : phase === 'charted'
        ? 'bg-white ring-zinc-900/10 dark:bg-transparent dark:ring-white/10'
        : 'bg-stone-50 ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/10';

  const dot =
    phase === 'building'
      ? 'bg-amber-500 dark:bg-amber-400'
      : phase === 'charted'
        ? 'bg-white ring-1 ring-inset ring-zinc-300 dark:bg-transparent dark:ring-white/25'
        : 'bg-emerald-500 dark:bg-emerald-400';

  const whenColor = phase === 'building' ? 'text-violet-600 dark:text-violet-400' : 'text-zinc-400 dark:text-zinc-500';

  return (
    <article className={`w-64 shrink-0 rounded-3xl p-5 ring-1 ${surface}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
        <span className={`font-mono text-[10px] tracking-wider uppercase ${whenColor}`}>{when}</span>
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-xs leading-5">{body}</p>
      {badge ? (
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet-600/10 px-2.5 py-1 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-400/10 dark:ring-violet-400/30">
          <span className="font-mono text-[9px] font-semibold text-violet-700 uppercase dark:text-violet-400">{badge}</span>
        </span>
      ) : null}
    </article>
  );
}

function AgentsTeaser() {
  return (
    <section aria-labelledby="agents-heading" className="px-6 py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div
          aria-hidden="true"
          className="order-2 rounded-3xl bg-white p-5 shadow-lg shadow-violet-600/5 ring-1 ring-violet-600/20 lg:order-1 dark:bg-white/[.03] dark:ring-violet-500/20"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-[10px] text-white">CL</span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">Claude</span>
            <span className="rounded-lg bg-violet-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-violet-700 ring-1 ring-inset ring-violet-600/30 dark:bg-violet-400/10 dark:text-violet-400 dark:ring-violet-400/30">
              Agent · MCP
            </span>
            <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">§ 6.2 · just now</span>
          </div>
          <p className="mt-3 text-sm leading-6">
            The engine allowlist in §6.2 is enforced in the web layer but the spec
            doesn&rsquo;t state the API re-validates it. Suggest adding a
            server-side assertion so a crafted request can&rsquo;t reach Kroki with
            an unlisted engine.
          </p>
          <div className="mt-4 flex gap-4 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="font-medium">Reply</span>
            <span>Resolve</span>
            <span className="ml-auto text-zinc-300 dark:text-zinc-600">posted via MCP · human review pending</span>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <span className="text-xs font-semibold tracking-wider text-violet-600 uppercase dark:text-violet-400">Next up · M4</span>
          <h2 id="agents-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Your next reviewer might not be human
          </h2>
          <p className="mt-4 text-sm leading-7">
            Kedge&rsquo;s MCP server makes AI agents first-class reviewers: they
            read the rendered doc, anchor comments to real passages, and wear a
            badge that says exactly what they are. Every AI output stays a draft
            until a human confirms it — agents never auto-act.
          </p>
          <p className="mt-3 text-sm leading-7">
            Close the loop: comments → AI digest → improve-prompt → your coding
            agent revises the doc → re-sync → the comments are still there.
          </p>
        </div>
      </div>
    </section>
  );
}

function SelfHostCta() {
  return (
    <section id="self-host" aria-labelledby="self-host-heading" className="scroll-mt-16 px-6 pb-24">
      <div className="mx-auto max-w-6xl rounded-3xl bg-zinc-900 p-8 ring-1 ring-white/10 sm:p-12 dark:bg-white/[.03]">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 id="self-host-heading" className="font-display text-3xl font-bold tracking-tight text-white">
              Your specs never have to leave home
            </h2>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              The open-source edition is the entire product — anchoring, approvals,
              the MCP server, all of it. AGPL-3.0, full parity with the SaaS, one
              compose file.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="rounded-full bg-emerald-400/10 px-5 py-2 text-sm font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20 hover:bg-emerald-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Read the self-hosting guide
              </Link>
              <a
                href={githubUrl}
                className="rounded-full bg-white/5 px-5 py-2 text-sm font-medium text-zinc-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                Star on GitHub
              </a>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="overflow-x-auto rounded-2xl bg-zinc-950/60 p-5 font-mono text-xs leading-7 text-zinc-300 ring-1 ring-inset ring-white/10"
          >
            <div>
              <span className="select-none text-emerald-400">$</span> git clone {githubUrl}
            </div>
            <div>
              <span className="select-none text-emerald-400">$</span> cd kedge/deploy &amp;&amp; docker compose up
            </div>
            <div className="text-zinc-500">✓ api · web · postgres · kroki</div>
            <div className="text-zinc-500">
              → http://localhost:8080 — importing <span className="text-zinc-300">docs/SPEC.md</span> via PAT
            </div>
            <div className="text-emerald-400">ready. nothing left the network.</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-zinc-900/10 bg-white px-6 py-10 dark:border-white/10 dark:bg-transparent">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">— comments that keep their place.</span>
        </div>
        <div className="flex items-center gap-5 text-xs text-zinc-500 sm:ml-auto">
          <a href={githubUrl} className={NAV_LINK}>
            GitHub
          </a>
          <Link href="/docs" className={NAV_LINK}>
            Docs
          </Link>
          <a href="#roadmap" className={NAV_LINK}>
            Roadmap
          </a>
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">AGPL-3.0</span>
        </div>
      </div>
    </footer>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  );
}

function AnchorGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 6.5v13.5" />
      <path d="M8 10h8" />
      <path d="M5 14.5c0 3.6 3.2 5.5 7 5.5s7-1.9 7-5.5" />
    </svg>
  );
}
