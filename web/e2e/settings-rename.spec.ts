import { expect, test } from '@playwright/test';
import { register, uniqueIdentity } from './helpers';

// Settings → General: the audited workspace rename (SPEC §16, M3.7 decision 11A;
// #101). A workspace owner renames the workspace and edits its slug from the
// General card that sits above Integrations; the new name shows in the chrome the
// settings page renders from the session, and a slug already taken by another
// workspace is rejected inline — never a raw error, never a silent no-op.
//
// The collision needs a real second workspace holding the target slug, so a
// throwaway context registers user B and claims it first (its own personal
// workspace, unique per run), then closes. User A drives the journey.

test('rename reflects in chrome and a taken slug is rejected inline', async ({ page, browser }) => {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const takenSlug = `taken-${stamp}`;

  // ---- User B claims the collision-target slug on their own workspace --------
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await register(pageB, uniqueIdentity('settings-rename-b'));
  await pageB.goto('/settings');
  await pageB.getByLabel('Workspace slug').fill(takenSlug);
  await pageB.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(pageB.getByText('Workspace updated.')).toBeVisible();
  await contextB.close();

  // ---- User A renames their workspace ---------------------------------------
  await register(page, uniqueIdentity('settings-rename'));
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  // The General card sits ABOVE Integrations (assert DOM order, not just presence).
  const generalHeading = page.getByRole('heading', { name: 'General' });
  const githubHeading = page.getByRole('heading', { name: 'GitHub' });
  await expect(githubHeading).toBeVisible();
  expect(
    await generalHeading.evaluate(
      (el, other) => Boolean(other && el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING),
      await githubHeading.elementHandle(),
    ),
  ).toBe(true);

  const newName = `Harbor Reviews ${stamp}`;
  const newSlug = `harbor-${stamp}`;

  await page.getByLabel('Workspace name').fill(newName);
  await page.getByLabel('Workspace slug').fill(newSlug);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Workspace updated.')).toBeVisible();

  // Reflects in chrome: the settings subtitle is server-rendered from the session,
  // and the rename's router.refresh re-fetches it with the new name.
  await expect(page.getByText(newName, { exact: true })).toBeVisible();

  // Persisted, not just client state: a fresh load seeds the field from the server.
  await page.goto('/settings');
  await expect(page.getByLabel('Workspace name')).toHaveValue(newName);
  await expect(page.getByLabel('Workspace slug')).toHaveValue(newSlug);

  // ---- Slug collision rejected inline ---------------------------------------
  await page.getByLabel('Workspace slug').fill(takenSlug);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('That slug is already taken.', { exact: false })).toBeVisible();
  // The rejected save never moved the slug: a reload still shows the good one.
  await page.goto('/settings');
  await expect(page.getByLabel('Workspace slug')).toHaveValue(newSlug);
});
