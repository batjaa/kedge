import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { FIXTURE_HOST } from './fixture-doc';
import { register, uniqueIdentity } from './helpers';

// The provenance chip on the home list (M3.10 #117, SPEC §11): every row tells
// you where its doc came from. This journey proves the acceptance criterion —
// docs imported by DIFFERENT ROUTES are visibly distinguishable on the home list
// — end to end through the real app: a URL import carries its source-host chip, a
// pasted doc carries the "pasted" chip, and both sit on the one list at once.
//
// Determinism: the URL is a loopback fixture (fixtures.ts) admitted by the guard's
// test-only FETCH_ALLOW_HOSTS; the paste has no source to fetch. The E2E queue is
// synchronous (serve-api.sh), so each 202 row settles on its own poll — but the
// chip is derived server-side and rides both the 202 and the settle payload, so it
// is visible throughout, no poll parking needed.

test('provenance chips distinguish a URL import from a pasted doc on the home list', async ({
  page,
}) => {
  await register(page, uniqueIdentity('provenance-chip'));

  const documents = page.getByRole('region', { name: 'Your documents' });
  const rows = documents.getByRole('listitem');

  // A brand-new workspace: the list teaches the entry point, no rows.
  await expect(page.getByText('No documents yet')).toBeVisible();

  // Route 1 — a URL import. Its row carries the source-host provenance chip.
  await page.getByLabel('Document URL', { exact: true }).fill(PLAIN_DOC.url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await expect(page).toHaveURL('/');

  // Route 2 — a pasted doc (no URL). Its row carries the "pasted" chip.
  await page.getByRole('tab', { name: 'Paste content', exact: true }).click();
  await page.getByLabel('Content', { exact: true }).fill('# Pasted scratch note\n\nJust a quick note, no source.');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // The two rows are visibly distinguishable by provenance — the whole point of
  // the chip: one shows the source host, the other the pasted label, side by side
  // on the same home list.
  await expect(documents.getByText(FIXTURE_HOST, { exact: true })).toBeVisible();
  await expect(documents.getByText('pasted', { exact: true })).toBeVisible();

  // And the provenance is real text (perceivable without vision, story 8): each
  // chip is announced with its "Source:" context, not a sight-only decoration.
  await expect(documents.getByText('Source:', { exact: false }).first()).toBeAttached();
});
