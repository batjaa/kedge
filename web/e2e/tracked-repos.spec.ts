import { expect, test } from '@playwright/test';
import { FIXTURE_ORIGIN } from './fixtures';
import { GITHUB_FIXTURE } from './github-fixture.mjs';
import { postInlineComment, register, threadRail, uniqueIdentity } from './helpers';

// Tracked repos end-to-end (SPEC §16, M3.6; testing decision 3; #95) — the whole
// module in one deterministic journey. The loopback fixture server emulates the
// minimal GitHub endpoints the scan pipeline calls (serve-fixtures.mjs +
// github-fixture.mjs), reached over plain http via the E2E-only GITHUB_API_HOST
// seam (serve-api.sh) and admitted by the same FETCH_ALLOW_HOSTS loopback
// exemption as the paste fixtures. Production is untouched.
//
// The loop: create a project → track the fixture repo with a `docs/**/*.md`
// pattern → PREVIEW shows exactly the three matched files (never the non-matching
// ones) → confirm → the first scan fills the project LIVE (rows appear importing
// and settle to ready without a reload) → the panel reports the counts → a comment
// is placed on the changed doc → the fixture MUTATES → Re-scan imports the new doc
// and re-syncs the changed one (its content updates AND the pre-mutation comment
// survives the re-anchoring ladder — the moat) → a third scan is an honest
// "already up to date".
//
// Determinism is by poll-parking, never timers (home-list.spec.ts's pattern): the
// per-row document poll is stubbed to hold materialized rows `importing` long
// enough to assert the live fill, then released so the real synchronous-ready
// settle proceeds. The scan poll (GET /api/v1/tracked-repos/{id}, a different
// path) is left alone — the sync E2E queue settles the scan on its first tick.

// Hold every /api/bff/documents/<id> per-ROW poll at "importing" (never the list
// route /api/bff/documents?…), so a materialized row can't settle before we assert
// it. Released with page.unroute to let the real ready settle proceed.
const PER_ROW_POLL = /\/api\/bff\/documents\/\d+(?:\?.*)?$/;

async function parkRowPoll(page: import('@playwright/test').Page): Promise<void> {
  await page.route(PER_ROW_POLL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'importing' }),
    }),
  );
}

test('track a fixture repo: preview, live fill, mutate, re-scan, and up-to-date', async ({
  page,
  request,
}) => {
  // A locally-reused fixture server may still hold a prior run's mutation — reset
  // the one fixture repo to generation 1 before anything reads it.
  await request.post(`${FIXTURE_ORIGIN}${GITHUB_FIXTURE.control.reset}`);

  await register(page, uniqueIdentity('tracked-repos'));

  // 1. Create a project on the home, then open its (empty) page via the created
  //    link (ProjectCreate offers it for exactly this next step).
  await page.getByLabel('Project name', { exact: true }).fill('Fixture specs');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('link', { name: 'Fixture specs', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Fixture specs' })).toBeVisible();
  const projectUrl = page.url();

  // With the fixture repo tracked, its docs live in their own SOURCE section
  // (M3.10 #118) headed by the repo's short name; a pasted doc lands under "Other
  // documents". The region only materializes once the repo is tracked (below).
  const projectDocuments = page.getByRole('region', { name: GITHUB_FIXTURE.slug });
  const importing = projectDocuments.getByText('Importing');

  // Park the per-row poll before any row can materialize.
  await parkRowPoll(page);

  // 2. Track the fixture repo with a docs/**/*.md pattern and PREVIEW.
  await page.getByLabel('Repository URL', { exact: true }).fill(GITHUB_FIXTURE.repoUrl);
  await page.getByLabel('Path pattern', { exact: true }).fill(GITHUB_FIXTURE.pattern);
  await page.getByRole('button', { name: 'Preview files', exact: true }).click();

  // 3. Preview shows exactly the three matched files (one nested, exercising `**`)
  //    and NONE of the non-matching entries (wrong folder, wrong extension).
  await expect(page.getByText('3 files match')).toBeVisible({ timeout: 30_000 });
  for (const file of GITHUB_FIXTURE.matched) {
    await expect(page.getByText(file.path, { exact: true })).toBeVisible();
  }
  for (const path of GITHUB_FIXTURE.nonMatching) {
    await expect(page.getByText(path, { exact: true })).toHaveCount(0);
  }

  // A sentinel proves the live fill that follows needs no reload — a hard reload
  // would wipe this window property.
  await page.evaluate(() => {
    (window as Window & { __noReload?: boolean }).__noReload = true;
  });

  // 4. Confirm → the tracked repo is persisted and its first scan runs.
  await page.getByRole('button', { name: 'Add & scan', exact: true }).click();

  // 5. The scan settles and materializes the three imported files as importing
  //    rows on the project island — without a reload — and the panel reports them.
  await expect(importing).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText('3 queued')).toBeVisible({ timeout: 30_000 });

  // 6. Release the parked poll: each importing row settles to ready in place.
  await page.unroute(PER_ROW_POLL);
  await expect(importing).toHaveCount(0, { timeout: 30_000 });
  expect(
    await page.evaluate(() => (window as Window & { __noReload?: boolean }).__noReload === true),
  ).toBe(true);

  // The three documents are now live links in the repo's OWN source section
  // (real synthesized titles, not the importing-row basenames), and they read in
  // REPO-PATH ORDER (#118) — `matched` is path-sorted, so the section reflects the
  // repository's own structure, not import order.
  const repoDocLinks = projectDocuments.getByRole('link');
  await expect(repoDocLinks).toHaveCount(GITHUB_FIXTURE.matched.length);
  for (const [index, file] of GITHUB_FIXTURE.matched.entries()) {
    await expect(repoDocLinks.nth(index)).toContainText(file.title);
  }

  // 6b. Dogfood the bucketing: a PASTED doc (no tracked repo) lands under "Other
  //     documents", never in the repo section — visibly grouped by source.
  const otherDocuments = page.getByRole('region', { name: 'Other documents' });
  await page.getByRole('tab', { name: 'Paste content', exact: true }).click();
  await page
    .getByLabel('Content', { exact: true })
    .fill('# Loose scratch note\n\nA pasted doc with no repository behind it.');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  // The "pasted" provenance chip appears under Other documents — and NOT in the
  // repo section, so grouping keeps sources apart.
  await expect(otherDocuments.getByText('pasted', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(projectDocuments.getByText('pasted', { exact: true })).toHaveCount(0);

  // 7. Place a comment on the CHANGED doc, anchored to a sentence that stays
  //    byte-identical across the mutation — the moat: it must survive the re-sync.
  await projectDocuments.getByRole('link', { name: GITHUB_FIXTURE.changed.title }).click();
  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });
  const changedDocUrl = page.url();
  await expect(page.getByText(GITHUB_FIXTURE.changed.gen1Marker)).toBeVisible();
  const survivingComment = 'Anchor me across the mutation.';
  await postInlineComment(page, GITHUB_FIXTURE.changed.stableSentence, survivingComment);

  // 8. Back on the project, MUTATE the fixture (one file changes, one is added),
  //    then Re-scan. Re-park so the new import row is observable while importing.
  await page.goto(projectUrl);
  await request.post(`${FIXTURE_ORIGIN}${GITHUB_FIXTURE.control.mutate}`);
  await parkRowPoll(page);
  await page.getByRole('button', { name: 'Re-scan', exact: true }).click();

  // 9. The re-scan imports the NEW file (materialized importing) and reports the
  //    diff: one queued, one re-synced, two unchanged.
  const rescanImporting = projectDocuments.getByText('Importing');
  await expect(rescanImporting).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText('1 queued')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('1 re-synced')).toBeVisible();
  await expect(page.getByText('2 unchanged')).toBeVisible();

  // 10. Release the poll: the new doc settles to ready and joins the list.
  await page.unroute(PER_ROW_POLL);
  await expect(rescanImporting).toHaveCount(0, { timeout: 30_000 });
  await expect(projectDocuments.getByRole('link', { name: GITHUB_FIXTURE.added.title })).toBeVisible();

  // 11. Open the changed doc: its content re-synced to the new generation, and the
  //     pre-mutation comment survived the re-anchoring (the moat assertion).
  await page.goto(changedDocUrl);
  await expect(page.getByText(GITHUB_FIXTURE.changed.gen2Marker)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(GITHUB_FIXTURE.changed.gen1Marker)).toHaveCount(0);
  await expect(threadRail(page).getByText(survivingComment, { exact: true })).toBeVisible();

  // 12. A third scan with nothing changed upstream is an honest no-op.
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Re-scan', exact: true }).click();
  await expect(page.getByText('Already up to date')).toBeVisible({ timeout: 30_000 });

  // 13. Un-track the repo (two-step inline confirm). Its documents STAY in the
  //     project — grouping must never hide them (#118): the repo section goes
  //     away and its docs reflow LIVE into "Other documents" (which, now that no
  //     repo is attached, is the plain "Documents" list again), still carrying
  //     their repo-path provenance chip (story 5). No reload — the section
  //     reconciles its own scope.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Remove tracking?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  // The repo's own section is gone…
  await expect(page.getByRole('region', { name: GITHUB_FIXTURE.slug })).toHaveCount(0);
  // …and its documents are still here, reflowed into the (now single) list — never
  // hidden by the un-track. (Provenance survival on the chip is API-unit-tested.)
  const reflowed = page.getByRole('region', { name: 'Documents', exact: true });
  await expect(reflowed.getByRole('link', { name: GITHUB_FIXTURE.changed.title })).toBeVisible({
    timeout: 30_000,
  });
});
