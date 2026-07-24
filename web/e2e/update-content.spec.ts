import { expect, test } from '@playwright/test';
import {
  documentTitle,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';

// Manual content update for a pasted document (#113). A pasted doc has no URL to
// re-pull, so its author versions it by re-pasting the body: the "Update content"
// affordance opens a paste surface and submitting mints a NEW version through the
// same pipeline a re-sync uses — comments re-anchor (survive or orphan), and an
// approval pinned to the old version goes stale. This journey drives that whole
// arc end to end against the real re-anchor endpoint, and proves an
// identical-content submit honestly reports no new version.

// Anchor phrases stay under 32 characters on purpose: the re-anchor core's
// fuzzy fallback (diff-match-patch) rejects a longer pattern, a pre-existing
// shared-pipeline limit unrelated to this feature (recorded in TODOS). A short
// deleted phrase still orphans cleanly through the same path.
const V1 = `# Update journey spec

Alpha stays put.

Beta will go away.`;

const V2 = `# Update journey spec

Alpha stays put.

Gamma is new here.`;

const SURVIVING_ANCHOR = 'Alpha stays put.';
const DELETED_ANCHOR = 'Beta will go away.';
const NEW_TEXT = 'Gamma is new here.';

test('paste → comment → update content → comments re-anchor and approval goes stale', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const author = uniqueIdentity('update-content');
  const survivingNote = `Keep an eye on Alpha ${author.email}`;
  const deletedNote = `This comment loses its anchor ${author.email}`;

  await register(page, author);

  // Paste the initial version and land on its review surface (5A: submit stays
  // home and prepends a row; click through).
  await page.getByRole('tab', { name: 'Paste content', exact: true }).click();
  await page.getByLabel('Content', { exact: true }).fill(V1);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  const rows = page.getByRole('region', { name: 'Your documents' }).getByRole('link');
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await rows.first().click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });
  await expect(documentTitle(page, 'Update journey spec')).toBeVisible();

  // Two anchored comments: one on text that survives the update, one on text the
  // update deletes.
  await postInlineComment(page, SURVIVING_ANCHOR, survivingNote);
  await postInlineComment(page, DELETED_ANCHOR, deletedNote);

  // Approve the current version, so the update can strand the approval as stale.
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toBeVisible();

  // Open the paste surface and submit the new body.
  await page.getByRole('button', { name: 'Update content', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Update document content' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Content', { exact: true }).fill(V2);
  await dialog.getByRole('button', { name: 'Update content', exact: true }).click();

  // The new version rendered: the fresh paragraph is present and the deleted one
  // is gone from the prose. Scope to the rendered article so neither match can
  // come from the dialog textarea.
  const prose = page.locator('article.prose');
  await expect(prose.getByText(NEW_TEXT)).toBeVisible({ timeout: 60_000 });
  await expect(prose.getByText(DELETED_ANCHOR)).toBeHidden();

  // The surviving comment carried onto the new version — still in the rail.
  const rail = threadRail(page);
  await expect(rail.getByText(survivingNote, { exact: true })).toBeVisible({ timeout: 30_000 });

  // The comment on deleted text lost its anchor: it lands in the orphaned tray.
  const orphanedTray = page.getByRole('region', { name: 'Orphaned threads' });
  await expect(orphanedTray).toBeVisible({ timeout: 30_000 });
  await expect(orphanedTray.getByText(deletedNote, { exact: true })).toBeVisible();

  // The approval pinned to the old version is now stale — the roster shows the
  // "current" marker only staleness produces.
  await expect(page.getByText(/· current/).first()).toBeVisible({ timeout: 30_000 });

  // An identical re-submit is honestly a no-op: no new version, plain feedback.
  await page.getByRole('button', { name: 'Update content', exact: true }).click();
  const dialogAgain = page.getByRole('dialog', { name: 'Update document content' });
  await dialogAgain.getByLabel('Content', { exact: true }).fill(V2);
  await dialogAgain.getByRole('button', { name: 'Update content', exact: true }).click();
  await expect(dialogAgain.getByText(/no new version/i)).toBeVisible({ timeout: 60_000 });
});
