import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  Compass,
  Link2,
  MessageSquareText,
  RefreshCw,
  Server,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { gitConfig } from '@/lib/shared';
import { LandingHeroForm } from './landing-hero-form';
import { LandingEmailCta } from './landing-email-cta';
import { SampleDemoButton } from './landing-sample-demo';

// The anonymous SaaS home: the Open Harbor marketing landing (SPEC m3.8, #109),
// reworked 2026-07-24 as a conversion pass. The funnel has two desired actions,
// in order: run the demo (one-click sample chip + the hero paste box) and leave
// an email (header "Get started", closing email CTA → /signup with the address
// handed off). Positioning of record: many sources in, one readable review page
// out, discussion anchored to the text, AI to strengthen the doc. Rendered only
// on the SaaS edition for an anonymous visitor; app/page.tsx keeps the
// self-hosted sign-in branch ahead of this. Design of record:
// docs/designs/variant-3-open-harbor.html — DESIGN.md tokens, no webfonts (the
// display face is self-hosted Space Grotesk via --font-display / the heading
// rule), both themes, fully responsive. House style: no em dashes in copy — in
// EVERY locale (the landing lint runs over each catalog's rendered markup).
//
// i18n (M3.9, #125): all landing CHROME reads from the `landing` catalog
// (messages/<locale>/landing.json) via useTranslations — usable here because
// every section component is a sync Server Component, and equally under the
// static-markup unit tests. The line the sweep draws, per SPEC m3.9 ("document
// content is never translated"): the product illustrations depict real reviews,
// so their depicted CONTENT — document prose, reviewer/agent comments, diff
// lines, file and project names, terminal commands — stays English exactly like
// the review-surface.webp screenshot beside them, while their depicted chrome
// (status chips, Reply/Resolve, Accept/Decline) localizes with the rest of the
// page. The language switcher for anonymous visitors lives in the footer
// (placement per messages/README.md; the component itself is #122's).
//
// All copy here is statically authored marketing content — hand-curated, never
// generated from ROADMAP.md (SPEC m3.8 Out of Scope). The product illustrations
// are honest static content: their action affordances are non-interactive by
// design (and styled cursor-default so they do not invite dead clicks). The
// review-surface image is a real screenshot of Kedge reviewing a real spec, not
// a mockup.

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
// The self-hosting guide lives in the repo (deploy/local/README.md), not on the
// docs surface — link the real location rather than the generic docs index.
const selfHostGuideUrl = `${githubUrl}/tree/${gitConfig.branch}/deploy/local`;
// The one-click demo target: Kedge's own spec, reviewed in Kedge. Dogfooding as
// the proof, and always a public URL the anonymous demo endpoint accepts.
const sampleSpecUrl = `${githubUrl}/blob/${gitConfig.branch}/docs/SPEC.md`;

// Shared link styling for the header/footer nav and CTAs.
const NAV_LINK = 'rounded-md hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-white';

export function Landing() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-600 antialiased dark:bg-zinc-900 dark:text-zinc-400">
      <LandingHeader />
      <main id="main">
        <Hero />
        <ReviewSurfaceShot />
        <HowItWorks />
        <AgentsTeaser />
        <Workspace />
        <Roadmap />
        <SelfHostCta />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  const t = useTranslations('landing');
  const navLinks = [
    { href: '#how', label: t('header.nav.how') },
    { href: '#workspace', label: t('header.nav.workspace') },
    { href: '#roadmap', label: t('header.nav.roadmap') },
    { href: '#self-host', label: t('header.nav.selfHost') },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-900/10 bg-stone-50/85 backdrop-blur dark:border-white/10 dark:bg-zinc-900/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
        <BrandMark />
        <nav
          aria-label={t('header.navLabel')}
          className="ml-auto hidden items-center gap-7 text-sm font-medium text-zinc-600 md:flex dark:text-zinc-400"
        >
          {navLinks.map((item) => (
            <a key={item.href} href={item.href} className={NAV_LINK}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <ThemeToggle />
          <Link
            href="/signin"
            className="hidden rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:inline-block dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10"
          >
            {t('header.signIn')}
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-4 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/30 hover:bg-emerald-600/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/30 dark:hover:bg-emerald-400/15"
          >
            {t('header.getStarted')}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const t = useTranslations('landing');
  return (
    <section className="relative overflow-hidden px-6 pt-32 pb-20" aria-labelledby="hero-heading">
      {/* Faint harbor-chart texture behind the illustration column. Decorative,
          light theme only (the artwork is ink on paper), masked so it never
          competes with the copy. */}
      <img
        src="/landing/hero-chart.webp"
        alt=""
        aria-hidden="true"
        width={1600}
        height={872}
        className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[55%] object-cover object-left opacity-[0.16] select-none [mask-image:linear-gradient(to_left,black_35%,transparent)] lg:block dark:lg:hidden"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600/10 px-3 py-1 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:ring-emerald-400/30">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t('hero.badge')}
            </span>
          </div>
          <h1
            id="hero-heading"
            className="mt-6 font-display text-5xl leading-[1.02] font-bold tracking-tight text-zinc-900 sm:text-6xl dark:text-white"
          >
            {t('hero.title.line1')}
            <br />
            {t('hero.title.line2')}
            <br />
            <span className="text-emerald-600 dark:text-emerald-400">{t('hero.title.accent')}</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7">
            {t('hero.lede')}
          </p>
          <LandingHeroForm sampleUrl={sampleSpecUrl} />
        </div>

        <HeroIllustration />
      </div>
    </section>
  );
}

// Decorative product illustration — the review surface as a static still. Hidden
// from assistive tech (the hero copy + form carry the message); its buttons are
// non-interactive by design, so nothing here is a dead control in the a11y tree.
// The depicted document prose, reviewer comment, and diff are CONTENT and stay
// English (SPEC m3.9: document content is never translated — the same rule that
// keeps the review-surface.webp screenshot English); the depicted chrome
// (chips, thread actions) localizes with the page.
function HeroIllustration() {
  const t = useTranslations('landing');
  return (
    <div className="relative cursor-default select-none" aria-hidden="true">
      <div className="rounded-3xl bg-white p-5 shadow-lg shadow-zinc-900/5 ring-1 ring-zinc-900/10 lg:rotate-1 dark:bg-white/[.03] dark:ring-white/10">
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
          Approvals are pinned to the version reviewed, and{' '}
          <mark className="box-decoration-clone border-b-2 border-emerald-600/60 bg-emerald-500/15 px-0.5 text-zinc-800 dark:border-emerald-500/60 dark:bg-emerald-400/10 dark:text-zinc-200">
            go visibly stale when the document moves on
          </mark>
          . No silent rubber stamps.
        </p>
        <div className="mt-4 rounded-2xl bg-stone-50 p-4 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/[.03] dark:ring-white/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">§ 9.2</span>
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Staleness rules</span>
            <span className="ml-auto rounded-lg bg-emerald-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-emerald-700 ring-1 ring-inset ring-emerald-600/30 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/30">
              {t('stills.openChip')}
            </span>
          </div>
          <div className="mt-3 flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[9px] text-white">SC</span>
            <p className="text-xs leading-5">Love this. Can a stale approver re-approve in one click from the diff?</p>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="font-medium">{t('stills.reply')}</span>
            <span>{t('stills.resolve')}</span>
            <span className="ml-auto font-medium text-emerald-700 dark:text-emerald-400">{t('stills.draftReply')}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-3xl bg-white p-5 shadow-lg shadow-zinc-900/5 ring-1 ring-zinc-900/10 lg:-mt-2 lg:ml-14 lg:-rotate-1 dark:bg-white/[.03] dark:ring-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{t('stills.suggestedEdit')}</span>
          <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30">
            {t('stills.pendingChip')}
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
            {t('stills.accept')}
          </span>
          <span className="rounded-full bg-stone-100 px-4 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            {t('stills.decline')}
          </span>
        </div>
      </div>

      <div className="absolute -bottom-6 -left-6 hidden items-center gap-2 rounded-full bg-white px-4 py-2 shadow-md ring-1 ring-zinc-900/10 lg:flex dark:bg-zinc-900 dark:ring-white/15">
        <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('stills.survivedBadge')}</span>
      </div>
    </div>
  );
}

// The product's core surface, full width — a real screenshot of a real review
// (not a mockup, not generated), framed in the same browser chrome as the
// workspace console still. This is the page's proof shot.
function ReviewSurfaceShot() {
  const t = useTranslations('landing');
  return (
    <section
      aria-labelledby="surface-heading"
      className="border-y border-zinc-900/5 bg-white px-6 py-20 dark:border-white/5 dark:bg-white/[.02]"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 id="surface-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            {t('surface.heading')}
          </h2>
          <p className="mt-4 text-sm leading-7">
            {t('surface.body')}
          </p>
        </div>
        <div className="mt-10 overflow-hidden rounded-3xl bg-white shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-900/10 dark:ring-white/10">
          <div className="flex items-center gap-1.5 border-b border-zinc-900/5 bg-stone-50 px-4 py-2.5 dark:border-white/10 dark:bg-zinc-950/40">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-zinc-900/10 dark:bg-white/10" />
            <span className="mx-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">kedge.review</span>
          </div>
          <img
            src="/landing/review-surface.webp"
            alt={t('surface.screenshotAlt')}
            width={1720}
            height={955}
            className="w-full"
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useTranslations('landing');
  const steps: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Link2,
      title: t('how.steps.import.title'),
      body: t('how.steps.import.body'),
    },
    {
      icon: MessageSquareText,
      title: t('how.steps.discuss.title'),
      body: t('how.steps.discuss.body'),
    },
    {
      icon: RefreshCw,
      title: t('how.steps.resync.title'),
      body: t('how.steps.resync.body'),
    },
  ];

  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-16 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-xl">
          <h2 id="how-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            {t('how.heading')}
          </h2>
          <p className="mt-4 text-sm leading-7">
            {t('how.body')}
          </p>
        </div>
        <ol className="mt-12 grid list-none gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <li key={step.title} className="rounded-3xl bg-white p-6 ring-1 ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/10">
              <h3 className="flex items-center gap-2.5 font-display text-lg font-semibold text-zinc-900 dark:text-white">
                <step.icon aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-6">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AgentsTeaser() {
  const t = useTranslations('landing');
  return (
    <section
      aria-labelledby="agents-heading"
      className="border-y border-zinc-900/5 bg-white px-6 py-20 dark:border-white/5 dark:bg-white/[.02]"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        {/* Depicted agent comment card: the comment body is CONTENT (an agent's
            authored words about a real spec passage) and stays English; the
            depicted chrome around it localizes. */}
        <div
          aria-hidden="true"
          className="order-2 cursor-default rounded-3xl bg-white p-5 shadow-lg shadow-violet-600/5 ring-1 ring-violet-600/20 select-none lg:order-1 dark:bg-white/[.03] dark:ring-violet-500/20"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-[10px] text-white">CL</span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">Claude</span>
            <span className="rounded-lg bg-violet-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-violet-700 ring-1 ring-inset ring-violet-600/30 dark:bg-violet-400/10 dark:text-violet-400 dark:ring-violet-400/30">
              {t('stills.agentChip')}
            </span>
            <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">§ 6.2 · {t('stills.justNow')}</span>
          </div>
          <p className="mt-3 text-sm leading-6">
            The engine allowlist in §6.2 is enforced in the web layer but the spec
            doesn&rsquo;t state the API re-validates it. Suggest adding a
            server-side assertion so a crafted request can&rsquo;t reach Kroki with
            an unlisted engine.
          </p>
          <div className="mt-4 flex gap-4 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="font-medium">{t('stills.reply')}</span>
            <span>{t('stills.resolve')}</span>
            <span className="ml-auto text-zinc-300 dark:text-zinc-600">{t('stills.viaMcp')}</span>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-violet-600 uppercase dark:text-violet-400">
            <Bot aria-hidden="true" className="h-3.5 w-3.5" />
            {t('agents.kicker')}
          </span>
          <h2 id="agents-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            {t('agents.heading')}
          </h2>
          <p className="mt-4 text-sm leading-7">
            {t('agents.body1')}
          </p>
          <p className="mt-3 text-sm leading-7">
            {t('agents.body2')}
          </p>
        </div>
      </div>
    </section>
  );
}

function Workspace() {
  const t = useTranslations('landing');
  const points = [
    t('workspace.points.status'),
    t('workspace.points.glance'),
    t('workspace.points.unfiled'),
  ];

  return (
    <section id="workspace" aria-labelledby="workspace-heading" className="scroll-mt-16 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
            {t('workspace.kicker')}
          </span>
          <h2 id="workspace-heading" className="mt-3 font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            {t.rich('workspace.heading', {
              code: (chunks) => (
                <span className="align-middle font-mono text-2xl text-emerald-700 dark:text-emerald-400">{chunks}</span>
              ),
            })}
          </h2>
          <p className="mt-4 text-sm leading-7">
            {t('workspace.body')}
          </p>
        </div>
        <ul className="mt-6 grid max-w-4xl list-none gap-3 text-sm sm:grid-cols-3">
          {points.map((point) => (
            <li key={point} className="flex gap-3">
              <Check aria-hidden="true" strokeWidth={2} className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
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
// styled text, deliberately inert. Its chrome (chips, column headers, counts,
// hints) localizes with the page; repo paths, project and file names are content
// and stay literal.
function WorkspaceConsole() {
  const t = useTranslations('landing');
  const rows: {
    name: string;
    chip: string;
    hue: keyof typeof HUE_CHIP;
    meta: string;
    retry?: boolean;
  }[] = [
    { name: 'SPEC.md', chip: t('workspace.console.chipInReview'), hue: 'amber', meta: t('workspace.console.metaSpec') },
    { name: 'DESIGN.md', chip: t('workspace.console.chipApproved'), hue: 'emerald', meta: t('workspace.console.metaDesign') },
    { name: 'rfc-017-anchoring.mdx', chip: t('workspace.console.chipOrphan'), hue: 'rose', meta: t('workspace.console.metaRfc') },
    { name: 'specs/m4-ai-agents.md', chip: t('workspace.console.chipImporting'), hue: 'sky', meta: t('workspace.console.metaScan') },
    { name: 'ROADMAP.md', chip: t('workspace.console.chipApproved'), hue: 'emerald', meta: t('workspace.console.metaRoadmap') },
    { name: 'legacy-import.html', chip: t('workspace.console.chipFailed'), hue: 'rose', meta: t('workspace.console.metaFailed'), retry: true },
  ];

  return (
    <div className="mt-10 cursor-default overflow-hidden rounded-3xl bg-white shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-900/10 select-none dark:bg-white/[.03] dark:ring-white/10">
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
                {t('workspace.console.activeChip')}
              </span>
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">⎇ kedgehq/kedge · main · docs/**/*.md</div>
            <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              <span>{t('workspace.console.docs6')}</span>
              <span>{t('workspace.console.open11')}</span>
              <span className="text-rose-600 dark:text-rose-400">{t('workspace.console.orphan1')}</span>
              <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 uppercase text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
                {t('workspace.console.rescan')}
              </span>
            </div>
          </div>
          <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-inset ring-zinc-900/5 dark:bg-white/[.03] dark:ring-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Platform RFCs</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{t('workspace.console.docs3')}</span>
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-600">⎇ kedgehq/platform · main · rfcs/*.md</div>
          </div>
          <div className="rounded-2xl border border-dashed border-zinc-900/15 p-4 dark:border-white/15">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">{t('workspace.console.unfiled')}</span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{t('workspace.console.docs2')}</span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{t('workspace.console.dragHint')}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-zinc-900/5 lg:col-span-8 dark:ring-white/10">
          <div className="flex items-center gap-2 border-b border-zinc-900/5 bg-stone-50 px-4 py-2 font-mono text-[10px] tracking-wider text-zinc-400 uppercase dark:border-white/10 dark:bg-zinc-950/40 dark:text-zinc-500">
            <span>{t('workspace.console.colDocument')}</span>
            <span className="ml-auto hidden sm:inline">{t('workspace.console.colMeta')}</span>
          </div>
          <div className="divide-y divide-zinc-900/5 dark:divide-white/5">
            {rows.map((row) => (
              <ConsoleRow
                key={row.name}
                name={row.name}
                chip={row.chip}
                hue={row.hue}
                meta={row.meta}
                retryLabel={row.retry ? t('workspace.console.retry') : undefined}
              />
            ))}
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
  retryLabel,
}: {
  name: string;
  chip: string;
  hue: keyof typeof HUE_CHIP;
  meta: string;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{name}</span>
      <span className={`rounded-lg px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ${HUE_CHIP[hue]}`}>
        {chip}
      </span>
      {retryLabel ? (
        <span className="font-mono text-[10px] text-zinc-500 uppercase underline decoration-zinc-300 dark:text-zinc-400 dark:decoration-zinc-700">
          {retryLabel}
        </span>
      ) : null}
      <span className="ml-auto font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{meta}</span>
    </div>
  );
}

function Roadmap() {
  const t = useTranslations('landing');
  const liveToday = [
    t('roadmap.live.import'),
    t('roadmap.live.threads'),
    t('roadmap.live.versions'),
    t('roadmap.live.projects'),
  ];
  const chartedNext = [
    t('roadmap.charted.ai'),
    t('roadmap.charted.inbox'),
    t('roadmap.charted.sync'),
    t('roadmap.charted.selfhost'),
  ];

  return (
    <section
      id="roadmap"
      aria-labelledby="roadmap-heading"
      className="scroll-mt-16 border-y border-zinc-900/5 bg-white px-6 py-20 dark:border-white/5 dark:bg-white/[.02]"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-xl">
          <h2 id="roadmap-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            {t('roadmap.heading')}
          </h2>
          <p className="mt-3 text-sm leading-7">
            {t('roadmap.intro')}
          </p>
        </div>
        <div className="mt-10 grid items-center gap-10 lg:grid-cols-[1fr_24rem]">
          <div className="grid gap-10 sm:grid-cols-2">
            <RoadmapColumn title={t('roadmap.liveTitle')} icon={BadgeCheck} items={liveToday} tone="live" />
            <RoadmapColumn title={t('roadmap.chartedTitle')} icon={Compass} items={chartedNext} tone="charted" />
          </div>
          {/* The harbor chart, literally: a paper chart of the route. Decorative,
              framed like an artifact in both themes. */}
          <img
            src="/landing/roadmap-chart.webp"
            alt=""
            aria-hidden="true"
            width={1400}
            height={763}
            className="hidden rounded-3xl ring-1 ring-zinc-900/10 select-none lg:block dark:ring-white/10"
          />
        </div>
        <p className="mt-10 max-w-2xl text-sm leading-7">
          {t('roadmap.closer')}
        </p>
      </div>
    </section>
  );
}

function RoadmapColumn({
  title,
  icon: Icon,
  items,
  tone,
}: {
  title: string;
  icon: LucideIcon;
  items: string[];
  tone: 'live' | 'charted';
}) {
  const iconColor =
    tone === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500';

  return (
    <div>
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wider text-zinc-900 uppercase dark:text-white">
        <Icon aria-hidden="true" className={`h-4 w-4 ${iconColor}`} />
        {title}
      </h3>
      <ul className="mt-4 grid list-none gap-3 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                tone === 'live'
                  ? 'bg-emerald-500 dark:bg-emerald-400'
                  : 'bg-white ring-1 ring-inset ring-zinc-300 dark:bg-transparent dark:ring-white/25'
              }`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelfHostCta() {
  const t = useTranslations('landing');
  return (
    <section id="self-host" aria-labelledby="self-host-heading" className="scroll-mt-16 px-6 py-20">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/10 dark:bg-white/[.03]">
        {/* The boathouse: your specs, home, with the server inside. Decorative. */}
        <img
          src="/landing/self-host-boathouse.webp"
          alt=""
          aria-hidden="true"
          width={1600}
          height={872}
          className="h-44 w-full object-cover select-none sm:h-56"
        />
        <div className="grid items-center gap-10 p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <h2 id="self-host-heading" className="font-display text-3xl font-bold tracking-tight text-white">
              {t('selfHost.heading')}
            </h2>
            <p className="mt-4 text-sm leading-7 text-zinc-400">
              {t('selfHost.body')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={selfHostGuideUrl}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-5 py-2 text-sm font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20 hover:bg-emerald-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                <Server aria-hidden="true" className="h-4 w-4" />
                {t('selfHost.guideCta')}
              </a>
              <a
                href={githubUrl}
                className="inline-flex items-center gap-2 rounded-full bg-white/5 px-5 py-2 text-sm font-medium text-zinc-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                <Star aria-hidden="true" className="h-4 w-4" />
                {t('selfHost.starCta')}
              </a>
            </div>
          </div>
          {/* Honest static terminal shot: the real one-command flow from
              deploy/local/README.md (`./deploy/local/up.sh`), not an invented
              `docker compose up` path. Commands and service names are content
              and stay literal; the two prose lines localize. */}
          <div
            aria-hidden="true"
            className="cursor-default overflow-x-auto rounded-2xl bg-zinc-950/60 p-5 font-mono text-xs leading-7 text-zinc-300 ring-1 ring-inset ring-white/10 select-none"
          >
            <div>
              <span className="select-none text-emerald-400">$</span> git clone {githubUrl}.git
            </div>
            <div>
              <span className="select-none text-emerald-400">$</span> cd kedge &amp;&amp; ./deploy/local/up.sh
            </div>
            <div className="text-zinc-500">✓ proxy · api · queue · web · postgres · kroki</div>
            <div className="text-zinc-500">
              → <span className="text-zinc-300">http://localhost:8080</span> · {t('selfHost.terminal.frontDoor')}
            </div>
            <div className="text-emerald-400">{t('selfHost.terminal.ready')}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// The closing move, matched to the funnel: run the demo, leave an email. The
// email rides sessionStorage into /signup (LandingEmailCta), the demo is one
// click away for anyone who wants proof first.
function FinalCta() {
  const t = useTranslations('landing');
  return (
    <section id="get-started" aria-labelledby="cta-heading" className="scroll-mt-16 px-6 pb-24">
      <div className="mx-auto max-w-6xl rounded-3xl bg-white p-8 ring-1 ring-zinc-900/10 sm:p-12 dark:bg-white/[.03] dark:ring-white/10">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="cta-heading" className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            {t('cta.heading')}
          </h2>
          <p className="mt-4 text-sm leading-7">
            {t('cta.body')}
          </p>
          <LandingEmailCta />
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('cta.proofPrompt')}</span>
            <SampleDemoButton url={sampleSpecUrl} label={t('cta.proofCta')} variant="link" />
          </p>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  const t = useTranslations('landing');
  return (
    <footer className="border-t border-zinc-900/10 bg-white px-6 py-10 dark:border-white/10 dark:bg-transparent">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('footer.tagline')}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-zinc-500 sm:ml-auto dark:text-zinc-400">
          <a href={githubUrl} className={NAV_LINK}>
            GitHub
          </a>
          <Link href="/docs" className={NAV_LINK}>
            {t('footer.docs')}
          </Link>
          <a href="#roadmap" className={NAV_LINK}>
            {t('footer.roadmap')}
          </a>
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">AGPL-3.0</span>
          {/* The anonymous visitor's language switcher (SPEC m3.9 story 6, 4A):
              the exact cookie + server action + refresh the app header uses, so
              a stranger's choice persists across visits without a session.
              Placement only — the component is #122's, reused untouched. */}
          <LanguageSwitcher />
        </div>
      </div>
    </footer>
  );
}
