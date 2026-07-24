import { expect, test } from '@playwright/test';
import { FIXTURE_DOC_TITLE, FIXTURE_DOC_URL } from './fixture-doc';

// The landing journey (SPEC m3.8 — Testing Decisions; #109). Two branches of the
// anonymous root, one per edition:
//
//   • SaaS — the anonymous root is the Open Harbor marketing landing, and its
//     hero hosts the working demo paste box. We assert the marketing surface
//     renders (hero, capability tour, roadmap, self-host CTA) AND that a paste in
//     the hero runs the *existing* demo import flow end to end, landing on the
//     freshly-minted share link. The render→share→claim loop itself is m1-demo's
//     job; here the point is that the flow is wired to the hero, unchanged.
//
//   • self-hosted — the anonymous root is the sign-in branch, never the landing.
//     A private instance stays private-feeling; the marketing surface must not
//     leak onto it. This runs against a SECOND web instance (playwright.config
//     `web-selfhosted`) whose server-side capability read points at the fixtures
//     server's self_hosted:true /config stub — the genuine edition-read path, the
//     only faithful way to drive app/page.tsx's edition branch end to end.
//
// Selector strategy follows the demo journeys: role/label based, exact where
// labels could collide.

// The self-hosted web instance's origin. MUST match WEB_SELFHOSTED_PORT in
// playwright.config.ts (a second `next dev`, own compile dir, fixtures /config).
const SELFHOSTED_ORIGIN = 'http://localhost:3100';

test.describe('landing', () => {
  test('SaaS: the anonymous root is the Open Harbor landing, and the hero paste runs the demo flow', async ({
    page,
  }) => {
    // The demo import + a cold render is the slow part, same budget as m1-demo.
    test.setTimeout(120_000);

    await page.goto('/');

    // The marketing surface: hero, capability tour, roadmap, self-host CTA.
    await expect(
      page.getByRole('heading', { name: /Paste a link\./, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Review where the doc is readable/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'The harbor chart' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your specs never have to leave home' }),
    ).toBeVisible();

    // The hero hosts the working, unchanged demo paste box: paste the fixture
    // URL, hit "Render it", and the demo flow lands on the share link the API
    // mints (the E2E queue is sync, so the import is done by the time it loads).
    await page.getByLabel('Document URL', { exact: true }).fill(FIXTURE_DOC_URL);
    await page.getByRole('button', { name: 'Render it', exact: true }).click();

    await expect(page).toHaveURL(/\/shared\/[A-Za-z0-9_-]{32,}/, { timeout: 45_000 });
    await expect(
      page.getByRole('heading', { name: FIXTURE_DOC_TITLE }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('self-hosted: the anonymous root is the sign-in branch, never the landing', async ({
    page,
  }) => {
    await page.goto(`${SELFHOSTED_ORIGIN}/`);

    // The edition read (self_hosted:true) sends the anonymous root to sign-in.
    await expect(page).toHaveURL(/:3100\/signin(\?|$)/);
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();

    // And the marketing landing must NOT be reachable on a self-hosted instance.
    await expect(
      page.getByRole('heading', { name: /Paste a link\./ }),
    ).toBeHidden();
  });
});
