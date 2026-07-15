import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_DOC_TITLE, FIXTURE_DOC_URL } from './fixture-doc';

// The M1 demo criterion, end to end (import-render spec — Testing Decisions,
// seam 3; ticket #26): *a stranger pastes a URL and gets a beautiful doc with
// zero signup* — plus the share + claim loop around it. One journey, not a
// suite (the coverage pack is #39):
//
//   1. An anonymous visitor on `/` pastes a URL and lands on the rendered demo
//      doc via its freshly-minted share URL — with a LIVE diagram: the fixture's
//      mermaid fence arrives as a cached SVG <img> served from the API's
//      /storage render cache, never as a plain code block.
//   2. The same share link opens read-only in a second, cookie-less browser
//      context — possession of the token is the whole capability.
//   3. Signing up through the "Claim this doc" CTA claims the doc into the new
//      workspace and lands on the owned document.
//
// Determinism: the pasted URL is a loopback fixture (e2e/fixture-doc.ts) served
// by e2e/serve-fixtures.mjs and admitted by the guard's test-only
// FETCH_ALLOW_HOSTS (serve-api.sh) — no live external URL anywhere. Diagrams
// render through KROKI_URL: a service container in CI, hosted kroki.io locally.
//
// Selector strategy follows m0-demo.spec.ts: role/label based and exact where
// labels collide (Sign in vs "... with GitHub"), so the journey survives
// cosmetic change. Document headings are asserted via `.first()` because the
// synthesized title legitimately appears twice (page header + the markdown
// body's own H1).

// The whole loop crosses two contexts and covers import, a cold Kroki render,
// signup, and claim — with next-dev compiling each route on first hit. 60s is
// tight in CI; a wider ceiling is not a retry, it still fails loudly.
const JOURNEY_TIMEOUT = 120_000;

test('paste a URL → rendered doc with live diagram → share opens read-only → sign up claims it', async ({
  page,
  browser,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  // Unique per run: the scratch DB isolates runs, but unique identities also
  // keep the journey green against a reused local stack.
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `m1-${stamp}@kedge.test`;
  const password = 'correct-horse-battery-staple';

  // 1. The anonymous SaaS home is the paste box (zero signup — the PLG wedge).
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'See any spec, beautifully rendered.' }),
  ).toBeVisible();

  await page.getByLabel('Document URL', { exact: true }).fill(FIXTURE_DOC_URL);
  await page.getByRole('button', { name: 'Render it', exact: true }).click();

  // 2. The API answers with a share URL and the web navigates straight to it —
  //    the visitor's whole capability to see the doc and come back. The E2E
  //    queue is sync, so by the time the share page loads the import is done.
  await expect(page).toHaveURL(/\/shared\/[A-Za-z0-9_-]{32,}/, {
    timeout: 45_000,
  });
  const shareUrl = page.url();

  //    The rendered demo doc: marked as claimable, titled from the fixture's
  //    first heading, prose readable.
  await expect(page.getByText('Demo document', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: FIXTURE_DOC_TITLE }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Comments must survive new versions')).toBeVisible();

  //    ... with a LIVE diagram: the mermaid fence became an <img> whose src is
  //    the API's cached render (/storage/diagrams/mermaid/<hash>.svg), and the
  //    SVG really decoded (naturalWidth > 0 — a 404 or an error body would be
  //    0). This is the assertion that proves Kroki rendered, in CI included.
  await expectLiveMermaidDiagram(page);

  // 3. The share link opens read-only in a second, cookie-less browser context:
  //    no session, no authenticated chrome — just the doc and the claim CTA.
  const strangerContext = await browser.newContext();
  try {
    const stranger = await strangerContext.newPage();
    await stranger.goto(shareUrl);

    await expect(
      stranger.getByRole('heading', { name: FIXTURE_DOC_TITLE }).first(),
    ).toBeVisible();
    await expectLiveMermaidDiagram(stranger);

    // Read-only, anonymous: none of the owner surface leaks through the token.
    await expect(
      stranger.getByRole('button', { name: 'Sign out', exact: true }),
    ).toBeHidden();
    await expect(stranger.getByRole('link', { name: /Claim this doc/ })).toBeVisible();
  } finally {
    await strangerContext.close();
  }

  // 4. Back in the visitor's context: claim through signup. The CTA carries the
  //    claim intent (`next=/documents/{id}?claim=1`), registration completes it,
  //    and the visitor lands on the clean, now-owned document URL.
  await page.getByRole('link', { name: /Claim this doc/ }).click();
  await expect(page).toHaveURL(/\/signup\?next=/);
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('M1 Claimer');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  //    The claim intent resolves to the owned doc: the interstitial POSTs the
  //    claim, then replaces to /documents/{id} (no ?claim=1 residue).
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });

  //    Owned now, inside the authenticated shell: reading it as this user
  //    passes the workspace policy (it moved — a foreign doc would 404), and
  //    the diagram still renders from the same cache.
  await expect(
    page.getByRole('heading', { name: FIXTURE_DOC_TITLE }).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Review queue/ })).toBeVisible();
  await expectLiveMermaidDiagram(page);
});

/**
 * The "live diagram" assertion (#26 acceptance): exactly one visible mermaid
 * <img>, src pointing at the API's content-addressed render cache, actually
 * decoded by the browser — and the fence's source nowhere as plain code.
 */
async function expectLiveMermaidDiagram(page: Page): Promise<void> {
  const diagram: Locator = page.getByRole('img', { name: 'mermaid diagram' });

  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toHaveAttribute(
    'src',
    /\/storage\/diagrams\/mermaid\/[0-9a-f]{64}\.svg$/,
  );

  // Rendered, not just referenced: the SVG loaded and decoded.
  await expect
    .poll(
      () => diagram.evaluate((img) => (img as HTMLImageElement).naturalWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // Never a plain code block: the mermaid source must not fall through to
  // <pre> (which is both the unknown-fence path and the render-failure panel).
  await expect(page.locator('pre', { hasText: 'flowchart LR' })).toHaveCount(0);
}
