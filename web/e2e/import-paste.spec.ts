import { expect, test } from '@playwright/test';
import { documentTitle, register, uniqueIdentity } from './helpers';

// Paste-content import (import-render spec — the #22 paste mode; #39). No URL, no
// source to re-sync: the reviewer pastes Markdown straight into the review-queue
// form and gets it rendered, title synthesized from the first heading. Proves the
// upload connector path end to end (create → project → render), the same page a
// URL import lands on.

const PASTED_CONTENT = `# Pasted spec: inline authoring

A reviewer can paste Markdown directly — no link needed, and Kedge renders it
here exactly as a URL import would.

## A second section

So the table of contents and body both come straight from the pasted text.`;

const SYNTHESIZED_TITLE = 'Pasted spec: inline authoring';

test('paste Markdown content → rendered document', async ({ page }) => {
  await register(page, uniqueIdentity('import-paste'));

  // Switch the import form to paste-content mode (the second tab).
  await page.getByRole('tab', { name: 'Paste content', exact: true }).click();

  await page.getByLabel('Content', { exact: true }).fill(PASTED_CONTENT);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // Submit stays home (5A): the pasted doc prepends as a row; click through to
  // reach its review surface. The synchronous E2E queue renders it on first load.
  const rows = page.getByRole('region', { name: 'Your documents' }).getByRole('link');
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await rows.first().click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });

  // Title synthesized from the first heading, body rendered from the pasted text.
  await expect(documentTitle(page, SYNTHESIZED_TITLE)).toBeVisible();
  await expect(
    page.getByText('A reviewer can paste Markdown directly'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A second section' })).toBeVisible();

  // A pasted doc has no source URL and never sits in the importing/failed state.
  await expect(page.getByText('Importing your document')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeHidden();
});
