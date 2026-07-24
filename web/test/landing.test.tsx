import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The hero form (LandingHeroForm) calls useRouter, and there is no app-router
// context under renderToStaticMarkup — stub next/navigation. We assert static
// markup only; the demo submit flow is the unchanged startDemo path (covered by
// the demo journeys), not re-tested here.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

// Import AFTER the mock so the hero form binds the stubbed router.
const { Landing } = await import('@/components/app/landing/landing');

describe('Landing (Open Harbor marketing home)', () => {
  const html = renderToStaticMarkup(<Landing />);

  it('renders the hero with the reused paste box (Document URL + Render it)', () => {
    // The hero copy of record (variant-3-open-harbor.html).
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

  it('renders the capability tour, console shot, roadmap and self-host CTA', () => {
    // How it works — the three steps.
    expect(html).toContain('Import from anywhere');
    expect(html).toContain('Discuss on the text itself');
    expect(html).toContain('Ship a new version, keep the review');
    // Workspace console shot (static illustration).
    expect(html).toContain('kedge.review/workspace');
    expect(html).toContain('SPEC.md');
    // Roadmap cards — hand-authored milestone copy.
    expect(html).toContain('The harbor chart');
    expect(html).toContain('Import &amp; render');
    expect(html).toContain('AI &amp; agents');
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

  it('keeps a real sign-in entry point (accounts still reachable)', () => {
    expect(html).toContain('href="/signin"');
    expect(html).toContain('Sign in');
  });

  it('exposes exactly one h1 (the hero) for a clean document outline', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});
