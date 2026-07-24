import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  uniqueIdentity,
} from './helpers';

// The M3.8 activity-feed demo criterion, end to end (spec:
// docs/specs/m3.8-activity-landing.md — Testing Decisions, the *dashboard-activity*
// journey; #111). The dashboard's reserved slot is now the Recent activity panel:
// a workspace-scoped, allowlisted, paginated feed read from the audit trail, each
// row linking to its target, loaded once on page load with no polling.
//
// This journey seeds a KNOWN workspace through the real browser — register, import
// a document (→ a `document.imported` row), post an inline comment (→ a
// `comment.created` row) — then pins the two spec lines against it:
//
//   • seeded events render their sentences AND link to their target: the comment
//     and the settled import both show, newest first, and their links resolve to
//     the same /documents/{id} the review surface lives at;
//   • a brand-new, empty workspace shows the designed empty state, not a broken or
//     absent panel.
//
// Determinism: the user and the document are created fresh here (helpers.ts) — no
// shared state, worker-safe. The fixture URL is a loopback source the E2E SSRF
// allowlist admits, and the E2E import queue is synchronous (serve-api.sh), so the
// `document.imported` audit row is written before we ever reach the dashboard.
const JOURNEY_TIMEOUT = 120_000;
const ANCHOR_TEXT = 'ordinary prose';

test('seeded activity renders sentences linking to their targets', async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('dash-activity');
  const comment = `Catching this up after time away ${author.email}`;

  await register(page, author);
  const docId = await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  // A real review action → a `comment.created` audit row for this workspace.
  await postInlineComment(page, ANCHOR_TEXT, comment);

  // Back to the dashboard: the feed is server-seeded on this navigation.
  await page.goto('/');
  const feed = page.getByRole('region', { name: 'Recent activity' });
  await expect(feed).toBeVisible();

  // Both seeded events render their sentences (the comment is newest, the import
  // follows) — rendered from the snapshot, so the titles read as they were.
  await expect(feed).toContainText('commented on');
  await expect(feed).toContainText('imported');
  await expect(feed).toContainText(PLAIN_DOC.title);

  // Every row links to its target document. The newest (the comment) is first.
  const firstLink = feed.getByRole('link').first();
  await expect(firstLink).toHaveAttribute('href', `/documents/${docId}`);

  // The link actually navigates to the review surface.
  await firstLink.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${docId}$`));
});

test('an empty workspace shows the designed empty state', async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const newcomer = uniqueIdentity('dash-activity-empty');
  await register(page, newcomer);

  // A fresh workspace has done nothing feed-worthy (registration and workspace
  // creation are deliberately off the feed's type allowlist), so the panel is
  // present but shows its designed empty state — never blank or broken.
  await page.goto('/');
  const feed = page.getByRole('region', { name: 'Recent activity' });
  await expect(feed).toBeVisible();
  await expect(feed).toContainText('No activity yet');
});
