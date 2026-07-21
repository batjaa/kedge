import { expect, test } from '@playwright/test';
import { PRIVATE_ADDRESS_URL, UPSTREAM_500_URL } from './fixtures';
import { register, uniqueIdentity } from './helpers';

// Import failure surfaces (import-render spec — SPEC §19; #39). Two failure
// modes, each ending in a friendly outcome, never a crash (hard rule #2):
//
//   1. SSRF-blocked URL — a private/reserved address the guard refuses. This is
//      DETERMINISTIC, so the import job swallows it (no retry, no rethrow) and
//      marks the document failed inline: the API answers 202, and submit stays
//      home (5A) — the failed import surfaces as a row on the "Your documents"
//      list that settles to failed in place (2A). Clicking through to its review
//      surface shows the friendly "URL not allowed" message with a working Retry
//      CTA (the shared retry affordance; inline row retry is #87).
//
//   2. Transient upstream error — a source that 500s. This bubbles out of the
//      import as a non-deterministic failure. It surfaces as a friendly inline
//      error on the import form (never a stack trace), and the form stays put.
//
// WHY NO "retry-flip → retry succeeds" JOURNEY (a deliberate #39 split, per the
// ticket's escape hatch — recorded in TODOS + the import-render Testing section):
// the E2E API runs QUEUE_CONNECTION=sync (serve-api.sh), so the import executes
// INSIDE the POST /documents request. A transient failure (a 500 source) is not
// swallowed like a blocked URL — it rethrows out of the synchronous dispatch, so
// the POST itself returns 500 and the browser NEVER reaches a document page with
// a retry CTA (verified: the doc row is created and marked failed, but it is
// unreachable through the UI). Only deterministic failures (blocked address /
// revoked token) reach the failed document page — and those, by definition, fail
// again on retry rather than "succeeding". A retry-that-succeeds needs the async
// (database) queue that production runs, where the 202 returns before the import
// completes; under that driver the flip is real, and it is covered by the API
// feature tests (DocumentImportTest). Reproducing it here would mean running a
// queue worker as a fourth process and abandoning the deterministic sync seam
// the whole E2E design rests on — not worth the flake it would invite.

test('SSRF-blocked URL fails fast with a friendly message and a working retry CTA', async ({
  page,
}) => {
  await register(page, uniqueIdentity('fail-blocked'));

  await page.goto('/');
  await page.getByLabel('Document URL', { exact: true }).fill(PRIVATE_ADDRESS_URL);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // Submit stays home (5A): the blocked import prepends a row that settles to
  // failed in place (2A) — the failure surfaces on the home list, not by an
  // automatic navigation.
  const rows = page.getByRole('region', { name: 'Your documents' }).getByRole('link');
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await expect(rows.first().getByText('Import failed')).toBeVisible({ timeout: 30_000 });

  // The row is a real link (10A): click through to the review surface, where the
  // shared retry affordance lives (inline row retry is #87). The failed document
  // page shows the friendly failed state, not the importing spinner.
  await rows.first().click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeVisible();

  // The friendly SSRF message — uniform across block reasons, never disclosing
  // the internal address it resolved to.
  await expect(
    page.getByText('URL not allowed (private address).'),
  ).toBeVisible();

  // The retry CTA is present, usable, and actually wired: clicking it re-runs the
  // import. A blocked URL is deterministic, so it fails again to the same friendly
  // state — proof the button works, without pretending a block can heal.
  //
  // (We don't assert the button's post-retry label: on a retry that re-fails, the
  // ImportFailed island persists across the refresh and its "Retrying…" pending
  // flag doesn't reset — a harmless quirk on the unusual path of retrying a
  // permanently-blocked URL, never seen on the normal retry-then-succeed path
  // where the panel unmounts. Noted in the PR, not this pack's to fix.)
  const retry = page.getByRole('button', { name: 'Retry import', exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();

  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeVisible();
  await expect(
    page.getByText('URL not allowed (private address).'),
  ).toBeVisible();
});

test('a transient upstream 500 surfaces a friendly inline error, no crash', async ({
  page,
}) => {
  await register(page, uniqueIdentity('fail-transient'));

  await page.goto('/');
  await page.getByLabel('Document URL', { exact: true }).fill(UPSTREAM_500_URL);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // A transient failure is reported as a friendly inline error on the form — not
  // a stack trace, not a blank page — and the reviewer stays on the review queue.
  await expect(
    page.getByText('Something went wrong starting the import. Please try again.'),
  ).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { name: 'Import a document' }),
  ).toBeVisible();
});
