import { expect, test } from '@playwright/test';
import { WARNINGS_DOC } from './fixtures';
import { documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// Import warnings (import-render spec — SPEC §5.2, §19; #39). Normalization is
// honest about what didn't survive: an HTML document with one image that
// re-hosts and one that fails still imports READY, and the failed image becomes
// an author-visible amber warning panel — never a silent drop, never a crash.
// The surviving image is re-hosted onto the media disk, so the document no longer
// depends on its origin.

test('HTML with a broken image → ready doc, expandable warning panel, working image re-hosted', async ({
  page,
}) => {
  await register(page, uniqueIdentity('import-warnings'));

  await importDocumentFromUrl(page, WARNINGS_DOC.url);

  // Ready, not failed: a broken image degrades to a warning, it does not fail the
  // import.
  await expect(documentTitle(page, WARNINGS_DOC.title)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeHidden();

  // The amber warning panel is present, collapsed, summarizing the single warning.
  const panel = page.locator('summary', { hasText: '1 import warning' });
  await expect(panel).toBeVisible();

  // Collapsed: the warning detail is hidden until the author expands it.
  const warningDetail = page.getByText("Couldn't fetch image", { exact: false });
  await expect(warningDetail).toBeHidden();

  // Expandable: opening the panel reveals the honest, self-contained warning —
  // which image failed and that the original link was kept.
  await panel.click();
  await expect(warningDetail).toBeVisible();
  await expect(page.getByText(WARNINGS_DOC.brokenImageUrl, { exact: false })).toBeVisible();

  // The working image survived by being re-hosted onto the media disk (/storage),
  // and it really decoded — the document no longer points at the origin for it.
  const rehosted = page.getByRole('img', { name: 'a working pixel' });
  await expect(rehosted).toBeVisible();
  await expect(rehosted).toHaveAttribute('src', /\/storage\/media\/\d+\/[0-9a-f]{64}\.png$/);
  await expect
    .poll(() => rehosted.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});
