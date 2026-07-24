import { expect, test, type Page } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// The M3.7 dashboard demo criterion, end to end (spec: docs/specs/m3.7-design-refresh.md
// — Testing Decisions, the *dashboard* journey; #105). The authenticated home is
// now the Open Harbor dashboard: a light-first shell whose stats strip and
// lifecycle filter chips read one workspace summary, a projects rail that stays
// live as documents are re-filed, and a document list that keeps imports settling
// in place. This journey seeds a KNOWN workspace through the real browser, then
// pins each of those against it:
//
//   • light default — <html> carries no `dark` class on a fresh dashboard;
//   • the stats strip matches the seeded counts (and clean-workspace alert stats
//     stay hidden while zero);
//   • each lifecycle chip's count equals the rows it narrows to, and the
//     narrowing is server-side — the BFF list read carries `?lifecycle=`, never a
//     client cull, so it stays correct across pagination (7A);
//   • the projects rail's per-project + derived Unfiled counts reconcile live
//     after a re-file, with NO reload (the #104 codex-review deferral);
//   • a rail card navigates to its project page;
//   • an import submitted under a filter flips the list back to All and settles
//     in place while the counts stay true (5A);
//   • the toggled dark choice persists across a full reload (per-device).
//
// Determinism: the user, the project, and every document are created fresh here
// (helpers.ts) — no shared state, worker-safe. The fixture URL is a loopback
// source the E2E SSRF allowlist admits, and the E2E import queue is synchronous
// (serve-api.sh), so imports settle without timers to race. Lifecycle is seeded
// through the author-only <select> each document page ships (the same PATCH the UI
// uses), never a back door. m0-demo owns the empty-shell theme dance; this journey
// pins the light default and the persisted choice on the *seeded* dashboard, where
// a reload must also bring the summary back.

/** Import a document and drive its author lifecycle <select> to `status`. Leaves
 *  the page on the document. */
async function importAndSetLifecycle(
  page: Page,
  url: string,
  status: 'in_review' | 'approved',
): Promise<void> {
  await importDocumentFromUrl(page, url);
  const select = page.getByLabel('Lifecycle status', { exact: true });
  await expect(select).toBeVisible();
  await select.selectOption(status);
  // The <select> commits to the PATCH's confirmed value only on success, so this
  // waits out the round-trip before we navigate on to seed the next document.
  await expect(select).toHaveValue(status);
}

test('the true dashboard: seeded stats, server-side filters, a live rail, and a settling import', async ({
  page,
}) => {
  await register(page, uniqueIdentity('dashboard'));

  // Light default (Open Harbor): a fresh dashboard renders light — <html> has no
  // `dark` class with no stored choice. Asserted before any toggle.
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/\bdark\b/);

  // --- Seed a known workspace -------------------------------------------------
  // One project (empty for now) and four documents: 1 draft, 2 in review, 1
  // approved — distinct bucket sizes so a filter that failed to narrow would show
  // a wrong count. All Unfiled at first; all plain markdown so the rows are
  // uniform and fast.
  await page.getByLabel('Project name', { exact: true }).fill('Harbor');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Created')).toBeVisible();

  await importDocumentFromUrl(page, PLAIN_DOC.url); // stays draft (the default)
  await importAndSetLifecycle(page, PLAIN_DOC.url, 'in_review');
  await importAndSetLifecycle(page, PLAIN_DOC.url, 'in_review');
  await importAndSetLifecycle(page, PLAIN_DOC.url, 'approved');

  // --- The seeded dashboard ---------------------------------------------------
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  const documents = page.getByRole('region', { name: 'Your documents' });
  const chips = page.getByRole('group', { name: 'Filter documents by lifecycle' });
  const rail = page.getByRole('complementary', { name: 'Projects' });

  // Stats strip matches the seeds: 4 documents, no open threads. The alert stats
  // (orphans / stale approvals / imports) stay hidden while zero.
  await expect(page.getByText('4 documents', { exact: true })).toBeVisible();
  await expect(page.getByText('0 open threads', { exact: true })).toBeVisible();
  await expect(page.getByText('approvals stale')).toHaveCount(0);

  // Chip counts match the seeds (7A: a chip's count is the total that state
  // narrows the list to).
  await expect(chips.getByRole('button', { name: /^All/ })).toContainText('· 4');
  await expect(chips.getByRole('button', { name: /In review/ })).toContainText('· 2');
  await expect(chips.getByRole('button', { name: /Approved/ })).toContainText('· 1');
  await expect(chips.getByRole('button', { name: /Draft/ })).toContainText('· 1');
  await expect(chips.getByRole('button', { name: /Needs attention/ })).toContainText('· 0');

  // --- The filter narrows server-side, and the counts agree with the rows -----
  // In review: the BFF list read carries `?lifecycle=in_review` (server-side, not
  // a client cull), the chip goes active, and exactly its 2 rows show.
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/bff/documents') &&
        res.url().includes('lifecycle=in_review') &&
        res.request().method() === 'GET' &&
        res.ok(),
    ),
    chips.getByRole('button', { name: /In review/ }).click(),
  ]);
  await expect(chips.getByRole('button', { name: /In review/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(documents.getByRole('listitem')).toHaveCount(2);

  // Approved: narrows to its single row.
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/bff/documents') &&
        res.url().includes('lifecycle=approved') &&
        res.ok(),
    ),
    chips.getByRole('button', { name: /Approved/ }).click(),
  ]);
  await expect(documents.getByRole('listitem')).toHaveCount(1);

  // Back to All: the narrowing reverses, all four return.
  await chips.getByRole('button', { name: /^All/ }).click();
  await expect(documents.getByRole('listitem')).toHaveCount(4);

  // --- The projects rail reconciles live across a re-file (the #104 deferral) --
  // Before: Harbor is empty, everything is Unfiled.
  const harborCard = rail.getByRole('link', { name: /Harbor/ });
  await expect(harborCard).toContainText('0 docs');
  await expect(rail.getByText('4 docs')).toBeVisible(); // Unfiled bucket

  // Re-file the one draft document into Harbor from its row chip — done under the
  // Draft filter so the single visible row's chip is unambiguous.
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/bff/documents') &&
        res.url().includes('lifecycle=draft') &&
        res.ok(),
    ),
    chips.getByRole('button', { name: /Draft/ }).click(),
  ]);
  await expect(documents.getByRole('listitem')).toHaveCount(1);
  await documents
    .getByLabel(`Project for ${PLAIN_DOC.title}`, { exact: true })
    .selectOption({ label: 'Harbor' });

  // After (no reload): the rail's per-project count and the derived Unfiled count
  // both reconcile — the summary + projects re-read piggybacks the re-file
  // callback rather than a page load.
  await expect(harborCard).toContainText('1 doc');
  await expect(rail.getByText('3 docs')).toBeVisible(); // Unfiled: 4 → 3

  // --- A rail card navigates to its project page ------------------------------
  await harborCard.click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Harbor' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Documents' })
      .getByRole('link', { name: new RegExp(PLAIN_DOC.title) }),
  ).toBeVisible();

  // --- An import settles in place while a filter is active (5A) ---------------
  await page.goto('/');
  // Filter to Draft (the re-filed doc), then import: submitting flips the chip
  // back to All so the new row is always watchable, and it settles in place.
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/bff/documents') &&
        res.url().includes('lifecycle=draft') &&
        res.ok(),
    ),
    chips.getByRole('button', { name: /Draft/ }).click(),
  ]);
  await expect(documents.getByRole('listitem')).toHaveCount(1);

  await page.getByLabel('Document URL', { exact: true }).fill(PLAIN_DOC.url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // Flipped to All; the new row joins and settles in place (no reload); and the
  // counts stay true — 5 documents total, 2 drafts.
  await expect(chips.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(documents.getByRole('listitem')).toHaveCount(5);
  await expect(documents.getByText('Importing')).toHaveCount(0);
  await expect(chips.getByRole('button', { name: /^All/ })).toContainText('· 5');
  await expect(chips.getByRole('button', { name: /Draft/ })).toContainText('· 2');

  // --- The toggled theme choice persists across a full reload -----------------
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(html).toHaveClass(/\bdark\b/); // the per-device choice survives
  await expect(page.getByText('5 documents', { exact: true })).toBeVisible(); // and the seed re-renders
});
