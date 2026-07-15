import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// URL import, happy path (import-render spec — seam 3; #39). An authenticated
// reviewer pastes a public URL into the review-queue import form and gets a
// rendered document: the importer fetches the loopback fixture through the
// SSRF-guarded doorway, normalizes, projects, and the page renders it — title
// synthesized from the first heading, prose intact.
//
// Determinism: the pasted URL is a loopback fixture (fixtures.ts) admitted by the
// guard's test-only FETCH_ALLOW_HOSTS (serve-api.sh); no live external URL.

test('paste a public URL → importing resolves → rendered document with title and body', async ({
  page,
}) => {
  await register(page, uniqueIdentity('import-url'));

  const id = await importDocumentFromUrl(page, PLAIN_DOC.url);
  expect(id).toBeGreaterThan(0);

  // The synthesized title (from the fixture's first heading) heads the page —
  // proof the import ran, not just that a row was created.
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  // The source URL is surfaced on the imported document's header.
  await expect(page.getByText(PLAIN_DOC.url)).toBeVisible();

  // The prose survived the round-trip verbatim: fetch → normalize → project →
  // render preserved the body.
  await expect(page.getByText(PLAIN_DOC.body)).toBeVisible();

  // Never the importing or failed state — this is a fully rendered document.
  await expect(page.getByText('Importing your document')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeHidden();
});
