import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  openInlineComposerForText,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';

const JOURNEY_TIMEOUT = 120_000;
const ANCHOR_TEXT = 'ordinary prose';

test('inline comment draft restores after reload and clears after submit', async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('draft-author');
  const draftText = `Draft survives reload ${author.email}`;

  await register(page, author);
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  await openInlineComposerForText(page, ANCHOR_TEXT);
  await page.getByLabel('Inline comment', { exact: true }).fill(draftText);

  await page.reload();
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  await openInlineComposerForText(page, ANCHOR_TEXT);
  await expect(page.getByLabel('Inline comment', { exact: true })).toHaveValue(draftText);

  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(threadRail(page).getByText(draftText, { exact: true })).toBeVisible();

  await page.reload();
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  await openInlineComposerForText(page, ANCHOR_TEXT);
  await expect(page.getByLabel('Inline comment', { exact: true })).toHaveValue('');
});
