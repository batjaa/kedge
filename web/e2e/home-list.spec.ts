import { expect, test } from '@playwright/test';
import { DIAGRAMS_DOC, PLAIN_DOC } from './fixtures';
import { documentTitle, register, uniqueIdentity } from './helpers';

// The home documents list is live (SPEC 11 M3.5; #85, decisions 5A + 2A + 10A).
// Its whole point — submit stays home and rows settle in place — is what this
// journey regression-guards: a fresh reviewer starts from the empty state, fires
// TWO imports from the one screen, watches both rows sit importing at once and
// settle to ready without a reload, and clicks one through to its review surface.
//
// Determinism: both URLs are loopback fixtures (fixtures.ts) admitted by the
// guard's test-only FETCH_ALLOW_HOSTS. The E2E queue is synchronous
// (serve-api.sh), so each import's DB row is already ready when the 202 returns;
// the row still prepends importing (the 202 body's status) and the per-row poll
// flips it to ready — the live transition under test.

test('imports stay home: two rows import at once and settle to ready in place', async ({
  page,
}) => {
  await register(page, uniqueIdentity('home-list'));

  // A brand-new workspace: the list area teaches the entry point, no rows.
  await expect(page.getByText('No documents yet')).toBeVisible();

  const documents = page.getByRole('region', { name: 'Your documents' });
  const rows = documents.getByRole('link');
  const importing = documents.getByText('Importing');

  // First import — prepends as an importing row; submit does NOT navigate.
  await page.getByLabel('Document URL', { exact: true }).fill(PLAIN_DOC.url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await expect(page).toHaveURL('/');

  // Second import — joins the first at the top of the same list.
  await page.getByLabel('Document URL', { exact: true }).fill(DIAGRAMS_DOC.url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // Both in flight from this one screen, at the same time (the list's reason to
  // exist). A sentinel proves the settle that follows needs no page reload — a
  // hard reload would wipe this window property.
  await expect(importing).toHaveCount(2);
  await page.evaluate(() => {
    (window as Window & { __noReload?: boolean }).__noReload = true;
  });

  // Each importing row polls itself and settles in place to ready — no refresh.
  await expect(importing).toHaveCount(0, { timeout: 30_000 });
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL('/');
  const survived = await page.evaluate(
    () => (window as Window & { __noReload?: boolean }).__noReload === true,
  );
  expect(survived).toBe(true);

  // The settle is announced to assistive tech through the polite live region
  // (10A). The region is visually hidden (sr-only), so assert it is present in
  // the DOM rather than visible.
  await expect(page.getByText(/^Import ready: /)).toBeAttached();

  // A row is a real link (10A): click it and land on the review surface, fully
  // rendered (synchronous queue), proving the list is the workspace's front door.
  await page
    .getByRole('link', { name: new RegExp(PLAIN_DOC.title) })
    .click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  await expect(page.getByText(PLAIN_DOC.body)).toBeVisible();
});
