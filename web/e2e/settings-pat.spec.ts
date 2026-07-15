import { expect, test } from '@playwright/test';
import { register, uniqueIdentity } from './helpers';

// Settings — GitHub PAT integration (import-render spec — SPEC §16; #39). A
// workspace connects a credential for private-repo imports: the token is sent
// once, stored encrypted, and only ever shown back as a last-4 mask. This drives
// the full connect → masked listing → remove → empty-state arc on the real page.
//
// The token here is OBVIOUSLY FAKE (a `github_pat_` prefix over junk). Connecting
// makes no live GitHub call — the API validates shape only and records the mask —
// so no real credential is ever needed or used.
const FAKE_PAT = 'github_pat_11AAAAAAAAAA0e2e0fake0token0dead0beef';
const MASKED = '••••beef';

test('add a fake PAT → masked listing appears → remove → empty state', async ({
  page,
}) => {
  await register(page, uniqueIdentity('settings-pat'));

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible();

  // Starts clean.
  await expect(page.getByText('No tokens connected yet.')).toBeVisible();

  // Connect the fake PAT.
  await page.getByLabel('GitHub personal access token').fill(FAKE_PAT);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  // The masked listing appears — the token itself is never echoed back, only its
  // provider badge and last-4 mask.
  await expect(page.getByText('GitHub PAT', { exact: true })).toBeVisible();
  await expect(page.getByText(MASKED)).toBeVisible();
  await expect(page.getByText('GitHub connected.', { exact: false })).toBeVisible();
  // The raw token never appears anywhere on the page.
  await expect(page.getByText(FAKE_PAT)).toHaveCount(0);

  // Remove it → back to the empty state.
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('No tokens connected yet.')).toBeVisible();
  await expect(page.getByText(MASKED)).toBeHidden();
});
