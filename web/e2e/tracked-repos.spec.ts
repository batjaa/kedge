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
// batch tracked-repo read is rewritten to hold the affected documents in their
// authoritative processing state long enough to assert the live fill, then
// released so the real synchronous-ready settle proceeds. This intentionally
// exercises the one bounded state read the product uses; the old per-row
// document-poll seam is no longer part of this path.

const PROCESSING_STATE_READ = /\/api\/v1\/tracked-repos\/\d+(?:\?.*)?$/;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });

  return { promise, resolve };
}

type ProcessingStateParking = {
  release: () => Promise<void>;
  pauseNextRead: () => { entered: Promise<void>; resume: () => void };
};

/**
 * Preserve real discovery facts and IDs, but freeze only the batch processing
 * projection once a scan has settled. New paths remain importing; changed paths
 * remain readable and updating. Releasing the route exposes the real completed
 * operations, proving the UI never treats the report's dispatch outcomes as live
 * status.
 */
async function parkProcessingState(
  page: import('@playwright/test').Page,
): Promise<ProcessingStateParking> {
  let parking = true;
  let nextRead: { entered: Deferred; resume: Deferred } | null = null;

  await page.route(PROCESSING_STATE_READ, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { data?: {
      last_scan_status?: string;
      last_scan_report?: { files?: Array<{ document_id: number | null; outcome: string }> };
      document_states?: Array<Record<string, unknown> & { id: number }>;
    } };
    const repo = body.data;
    const heldRead = nextRead;

    if (heldRead) {
      nextRead = null;
      heldRead.entered.resolve();
      await heldRead.resume.promise;
    }

    // A release can begin while this handler is awaiting the real response. In
    // that case, return the authoritative body rather than fulfill a stale
    // parked projection after interception has been removed.
    if (!parking || repo?.last_scan_status !== 'ok' || !repo.last_scan_report?.files || !repo.document_states) {
      await route.fulfill({ response });
      return;
    }

    const outcomes = new Map(
      repo.last_scan_report.files
        .filter((file) => file.document_id !== null)
        .map((file) => [file.document_id as number, file.outcome]),
    );
    repo.document_states = repo.document_states.map((state) => {
      const outcome = outcomes.get(state.id);
      if (outcome === 'import_queued') {
        return { ...state, status: 'importing', last_sync_status: 'processing', sync_error: null };
      }
      if (outcome === 'resync_queued') {
        return { ...state, status: 'ready', last_sync_status: 'processing', sync_error: null };
      }
      return state;
    });

    await route.fulfill({ response, json: body });
  });

  const release = async () => {
    // Playwright's ordinary unroute() does not drain handlers that are already
    // inside route.fetch()/route.fulfill(). Flip this first so an in-flight
    // handler returns the real response, then wait for all test-owned page
    // routes to finish before removing their interception.
    parking = false;
    await page.unrouteAll({ behavior: 'wait' });
  };

  return {
    release,
    pauseNextRead: () => {
      const entered = deferred();
      const resume = deferred();
      nextRead = { entered, resume };

      return { entered: entered.promise, resume: resume.resolve };
    },
  };
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

  // Park the one batched processing projection before any row can materialize.
  let processingState = await parkProcessingState(page);

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
  await expect(page.getByText('3 new files · 0 changed · 0 unchanged')).toBeVisible({ timeout: 30_000 });

  // 6. Reproduce the release race deterministically: an entered handler has
  // fetched the real response but cannot fulfill until the explicit barrier is
  // opened. release() must wait for it, rather than unroute it underneath the
  // pending route.fulfill().
  const heldRead = processingState.pauseNextRead();
  await heldRead.entered;
  let releaseFinished = false;
  const release = processingState.release().then(() => {
    releaseFinished = true;
  });
  await Promise.resolve();
  expect(releaseFinished).toBe(false);
  heldRead.resume();
  await release;

  // Each importing row now settles to ready in place.
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

  // …and the path-ordered rows read as DIRECTORY CLUSTERS (M3.10 #119, story 3):
  // the matched files sort `docs/architecture.md` · `docs/guide/getting-started.md`
  // · `docs/overview.md`, so the nested file lands BETWEEN the two docs/* files —
  // a `docs/guide` divider for the nested cluster and `docs` twice (the parent
  // label legitimately recurs across the nested one; a repeated label is tolerated
  // by design). The chips render full paths, so the divider labels match exactly.
  const dividerRows = projectDocuments.locator('li[aria-hidden="true"]');
  await expect(dividerRows).toHaveCount(3);
  await expect(dividerRows.filter({ hasText: /^docs\/guide$/ })).toHaveCount(1);
  await expect(dividerRows.filter({ hasText: /^docs$/ })).toHaveCount(2);
  // The dividers are decorative to assistive tech (#119, AC b): being aria-hidden,
  // they never join the accessible list, so it still reports exactly the three
  // documents — clustering is sight-only sugar, the paths already ride the chips.
  await expect(projectDocuments.getByRole('listitem')).toHaveCount(GITHUB_FIXTURE.matched.length);

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
  //    then Re-scan. Re-park so both the new import and the existing readable
  //    document's update are observable while processing.
  await page.goto(projectUrl);
  await request.post(`${FIXTURE_ORIGIN}${GITHUB_FIXTURE.control.mutate}`);
  processingState = await parkProcessingState(page);
  await page.getByRole('button', { name: 'Re-scan', exact: true }).click();

  // 9. The re-scan imports the NEW file (materialized importing) and keeps the
  //    immutable discovery facts separate from current document completion.
  const rescanImporting = projectDocuments.getByText('Importing');
  await expect(rescanImporting).toHaveCount(1, { timeout: 30_000 });
  await expect(projectDocuments.getByText('Updating')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText('1 new file · 1 changed · 2 unchanged')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('All documents ready')).toHaveCount(0);

  // 10. Release the batch state: the new doc settles to ready and joins the list;
  //     the completed update is confirmed separately rather than inferred at
  //     discovery time.
  await processingState.release();
  await expect(rescanImporting).toHaveCount(0, { timeout: 30_000 });
  await expect(projectDocuments.getByText('Updating')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('All documents ready')).toBeVisible({ timeout: 30_000 });
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
