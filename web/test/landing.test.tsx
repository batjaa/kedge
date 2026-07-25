import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/lib/i18n/messages';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/config';

// The hero form (LandingHeroForm) calls useRouter, and there is no app-router
// context under renderToStaticMarkup — stub next/navigation. We assert static
// markup only; the demo submit flow is the unchanged startDemo path (covered by
// the demo journeys), not re-tested here.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Import AFTER the mock so the hero form binds the stubbed router.
const { Landing } = await import('@/components/app/landing/landing');

// The landing is localized (M3.9 #125): render it exactly the way the root
// layout does in production — under NextIntlClientProvider with the merged
// (en-US fallback baked in) message tree for a locale.
function renderLanding(locale: Locale): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <Landing />
    </NextIntlClientProvider>,
  );
}

describe('Landing (Open Harbor marketing home, conversion pass 2026-07-24)', () => {
  const html = renderLanding('en-US');

  it('renders the hero with the reused paste box (Document URL + Render it)', () => {
    expect(html).toContain('Paste a link.');
    expect(html).toContain('Zero signup.');
    // The working demo box: an accessibly-labelled URL field and the same
    // "Render it" submit the demo journeys drive.
    expect(html).toContain('Document URL');
    expect(html).toContain('id="demo-url"');
    expect(html).toContain('Render it');
    // The hero CTA uses the solid-emerald variant DESIGN.md reserves for it.
    expect(html).toContain('bg-emerald-600');
  });

  it('offers the one-click sample demo (Kedge’s own SPEC.md) in hero and closer', () => {
    // Two placements: the hero chip and the final-CTA proof link. Both run the
    // same anonymous demo flow against the repo's own SPEC.md.
    expect(html.match(/Render Kedge’s own SPEC\.md/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('No URL handy?');
  });

  it('renders the real review-surface screenshot as the proof shot', () => {
    expect(html).toContain('Comments that keep their place');
    expect(html).toContain('/landing/review-surface.webp');
    // The screenshot is content, not decoration — it must carry a real alt.
    expect(html).toContain('A spec rendered in Kedge');
  });

  it('renders the capability tour, console shot, roadmap and self-host CTA', () => {
    // How it works — the three steps.
    expect(html).toContain('Import from anywhere');
    expect(html).toContain('Discuss on the text itself');
    expect(html).toContain('Ship a new version, keep the review');
    // Workspace console shot (static illustration).
    expect(html).toContain('kedge.review/workspace');
    expect(html).toContain('SPEC.md');
    // The compressed roadmap: outcome columns, no milestone codes.
    expect(html).toContain('Live today, charted next');
    expect(html).toContain('Charted next');
    expect(html).not.toContain('M0–M1');
    // Self-host story — the honest one-command flow (deploy/local/up.sh), not an
    // invented compose path.
    expect(html).toContain('Your specs never have to leave home');
    expect(html).toContain('./deploy/local/up.sh');
  });

  it('anchors the in-page nav to real section ids', () => {
    for (const id of ['how', 'workspace', 'roadmap', 'self-host']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it('keeps both account entry points (sign in + get started → /signup)', () => {
    expect(html).toContain('href="/signin"');
    expect(html).toContain('Sign in');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('Get started');
  });

  it('renders the closing email CTA that routes to signup', () => {
    expect(html).toContain('Start your first review in 60 seconds');
    expect(html).toContain('id="cta-email"');
    expect(html).toContain('Create my workspace');
  });

  it('exposes exactly one h1 (the hero) for a clean document outline', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe('Landing i18n (M3.9 #125 — catalogs, footer switcher, house style)', () => {
  // SPEC m3.9 story 6: an es-US visitor gets the Spanish landing on first paint.
  // This is the render seam of that journey — the same merged message tree the
  // request config resolves for an es-US Accept-Language, rendered from scratch
  // (no switch, no client hydration): the full funnel reads Spanish.
  it('renders the Spanish landing from the es-US catalog on first paint', () => {
    const html = renderLanding('es-US');
    // Hero.
    expect(html).toContain('Pega un enlace.');
    expect(html).toContain('Cero registro.');
    expect(html).not.toContain('Paste a link.');
    // Demo affordance.
    expect(html).toContain('URL del documento');
    expect(html).toContain('Renderízalo');
    // Roadmap band.
    expect(html).toContain('Disponible hoy');
    // Email funnel + footer.
    expect(html).toContain('Crear mi espacio de trabajo');
    expect(html).toContain('Comentarios que no pierden su lugar.');
  });

  it('places the language switcher in the footer for anonymous visitors', () => {
    // The switcher is #122's component (endonyms are never translated), so its
    // four options prove the placement in every locale's markup; the persistence
    // path (cookie server action + refresh) is the i18n journeys' job.
    const html = renderLanding('en-US');
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).toContain('<select');
    for (const endonym of ['English', 'Español', 'Монгол', 'Deutsch']) {
      expect(footer).toContain(endonym);
    }
  });

  // House style (conversion pass 2026-07-24): no em dashes in visitor-facing
  // text — and translations owe the same discipline (#125 AC). The illustration
  // stills and code comments are rendered markup too, so the whole document must
  // be clean in EVERY locale, not just the authored en-US.
  for (const locale of SUPPORTED_LOCALES) {
    it(`keeps the ${locale} landing markup free of em dashes (house style)`, () => {
      expect(renderLanding(locale)).not.toContain('—');
    });
  }
});
