import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { register, uniqueIdentity } from './helpers';

// Projects end-to-end (SPEC §16, M3.6; stories 1, 3, 4, 6). The acceptance
// journey: create a project → import a document → file it under the project from
// its row chip → the home re-groups under the project header → the project page
// lists it with the same live rows. Deterministic: the fixture URL is a loopback
// source admitted by the guard's test-only FETCH_ALLOW_HOSTS, and the E2E queue
// is synchronous (serve-api.sh), so the import settles without timers to race.

test('create a project, file a document into it, and see it grouped and on the project page', async ({
  page,
}) => {
  await register(page, uniqueIdentity('projects'));

  const documents = page.getByRole('region', { name: 'Your documents' });

  // 1. Create a project. It appears in the chips and (once filled) the headers.
  await page.getByLabel('Project name', { exact: true }).fill('Anchoring');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Created')).toBeVisible();

  // 2. Import a document — it prepends as an Unfiled row and settles to ready.
  await page.getByLabel('Document URL', { exact: true }).fill(PLAIN_DOC.url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(documents.getByRole('listitem')).toHaveCount(1, { timeout: 30_000 });
  // Wait for the per-row poll to settle it out of importing before assigning, so
  // no in-flight poll runs concurrently with the assignment.
  await expect(documents.getByText('Importing')).toHaveCount(0, { timeout: 30_000 });

  // 3. File it under the project from the row's project chip.
  await page
    .getByLabel(`Project for ${PLAIN_DOC.title}`, { exact: true })
    .selectOption({ label: 'Anchoring' });

  // 4. The home re-groups: the project header (a link to its page) now carries
  // the document. Unfiled is gone — the one doc is filed.
  const groupHeader = documents.getByRole('link', { name: 'Anchoring', exact: true });
  await expect(groupHeader).toBeVisible();
  await expect(documents.getByRole('link', { name: new RegExp(PLAIN_DOC.title) })).toBeVisible();

  // 5. The project page lists the same document with the same live rows.
  await groupHeader.click();
  await expect(page).toHaveURL(/\/projects\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Anchoring' })).toBeVisible();
  const projectDocuments = page.getByRole('region', { name: 'Documents' });
  await expect(
    projectDocuments.getByRole('link', { name: new RegExp(PLAIN_DOC.title) }),
  ).toBeVisible();
});
