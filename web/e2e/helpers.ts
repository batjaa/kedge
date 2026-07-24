import { expect, type Locator, type Page } from '@playwright/test';
import { latestReviewerMagicLinkUrl } from './mailbox';

// Shared journey steps for the coverage pack (#39). Every spec registers its OWN
// unique user and creates its OWN documents through these helpers — no fixture
// user, no shared document, no order dependence — so the pack is safe to run at
// workers > 1 even though the config pins workers: 1 (the user's scope decision).
// The steps mirror the role/label, exact-match selector discipline the M0 and M1
// journeys established (m0-demo.spec.ts, m1-demo.spec.ts).

export interface Identity {
  email: string;
  password: string;
  name: string;
}

// One stamp per process, so identities are unique across a reused local stack
// (the scratch DB already isolates a fresh run) AND across parallel workers.
const RUN_STAMP = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

/**
 * A fresh identity, unique per run and per call. `prefix` names the journey so a
 * stray row in the scratch DB is traceable to the spec that made it.
 */
export function uniqueIdentity(prefix: string): Identity {
  seq += 1;
  return {
    email: `${prefix}-${RUN_STAMP}-${seq}@kedge.test`,
    password: 'correct-horse-battery-staple',
    name: 'E2E Reviewer',
  };
}

/**
 * Register through the real browser and land on the authenticated shell — the
 * same cross-app cookie handshake the M0 journey proves, reused as a precondition
 * here. Leaves the page on `/` (the review queue).
 */
export async function register(page: Page, identity: Identity): Promise<void> {
  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill(identity.name);
  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
}

/**
 * Sign in through the real browser. `expectUrl` is where the app should land
 * afterwards (default `/`); a deep-link sign-in lands on the `next` target
 * instead. "Sign in" is matched exactly so it never collides with the
 * "Continue with GitHub" button (the M0 selector lesson).
 */
export async function signIn(
  page: Page,
  identity: Pick<Identity, 'email' | 'password'>,
  expectUrl: string | RegExp = '/',
): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(expectUrl);
}

/**
 * Import a document from a URL through the authenticated review-queue form, then
 * land on its page. Submit now STAYS on the home (5A): the import prepends as a
 * new row on the "Your documents" list rather than navigating, so this drives the
 * real flow — submit, wait for the row to appear at the top, click through to the
 * review surface. Gating on the row COUNT rising by one (not just `.first()`)
 * keeps it correct for callers that import several docs in a row. The E2E queue
 * is synchronous (serve-api.sh), so the click lands on a fully-rendered document,
 * no poll to wait on. Returns the numeric document id parsed from the URL.
 */
export async function importDocumentFromUrl(page: Page, url: string): Promise<number> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Import a document' }),
  ).toBeVisible();

  // Count STRUCTURAL rows, not anchors: a failed row renders two anchors (the row
  // link plus a Reconnect link), which would break link-count arithmetic. Each
  // list row is one listitem regardless of how many actions it carries.
  const rows = page.getByRole('region', { name: 'Your documents' }).getByRole('listitem');
  const before = await rows.count();

  await page.getByLabel('Document URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  // The 202'd document prepends as a new row; the newest sits first. Click that
  // row's OWN document link (its first anchor), never a Reconnect link a failed
  // row might also render.
  await expect(rows).toHaveCount(before + 1, { timeout: 30_000 });
  await rows.first().getByRole('link').first().click();

  await expect(page).toHaveURL(/\/documents\/\d+$/, { timeout: 30_000 });
  const match = /\/documents\/(\d+)$/.exec(page.url());
  if (!match) throw new Error(`expected a document URL, got ${page.url()}`);
  return Number(match[1]);
}

/**
 * The document's synthesized title heading. It legitimately appears twice — the
 * page header and the rendered body's own first heading — so callers assert
 * `.first()`; this returns that locator.
 */
export function documentTitle(page: Page, title: string) {
  return page.getByRole('heading', { name: title }).first();
}

/** Create a share link from the authenticated document page and return its one-time URL. */
export async function createShareLink(page: Page, expiryLabel = 'Expires in 7 days'): Promise<string> {
  await page.getByRole('heading', { name: 'Share links' }).scrollIntoViewIfNeeded();
  await page.getByLabel('Share expiry', { exact: true }).selectOption({ label: expiryLabel });
  await page.getByRole('button', { name: 'Create share link', exact: true }).click();

  await expect(page.getByText('it is shown only once', { exact: false })).toBeVisible();
  const shareUrl = await page.locator('input[readonly]').inputValue();
  expect(shareUrl).toMatch(/\/shared\/[A-Za-z0-9_-]{32,}$/);

  return shareUrl;
}

/**
 * Drive the reviewer identity flow through the actual browser:
 * share page → request email → read log-mailbox link → GET signed API link →
 * web share page auto-completes via POST and lands verified.
 */
export async function verifyReviewerByMagicLink(
  page: Page,
  shareUrl: string,
  email: string,
  title: string,
): Promise<void> {
  await page.goto(shareUrl);
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verify your email to comment' })).toBeVisible();

  await page.getByLabel('Reviewer email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send link', exact: true }).click();
  await expect(
    page.getByText('Check your email for a link to continue reviewing.'),
  ).toBeVisible();

  const magicLinkUrl = await latestReviewerMagicLinkUrl({ email });
  await page.goto(magicLinkUrl);

  await expect(page).toHaveURL(/\/shared\/[A-Za-z0-9_-]+\?verified=1$/, { timeout: 30_000 });
  await expect(
    page.getByText('Email verified. You can comment on this document now.'),
  ).toBeVisible();
  await expect(page.getByText('Shared document · verified reviewer')).toBeVisible();
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
}

/** Programmatically select exact rendered prose so the browser Selection API drives anchor capture. */
export async function selectDocumentText(page: Page, exact: string, occurrence = 0): Promise<void> {
  const result = await page.evaluate(
    async ({ exact, occurrence }) => {
      const root = document.querySelector<HTMLElement>('article.prose');
      if (!root) return { ok: false, reason: 'article.prose not found' };

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let target: Text | null = null;
      let offset = -1;

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const value = node.nodeValue ?? '';
        const foundAt = value.indexOf(exact);
        if (foundAt === -1) continue;

        if (seen === occurrence) {
          target = node;
          offset = foundAt;
          break;
        }
        seen += 1;
      }

      if (!target || offset < 0) {
        return { ok: false, reason: `text not found: ${exact}` };
      }

      const range = document.createRange();
      range.setStart(target, offset);
      range.setEnd(target, offset + exact.length);

      const selection = window.getSelection();
      if (!selection) return { ok: false, reason: 'Selection API unavailable' };
      selection.removeAllRanges();
      selection.addRange(range);

      target.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const rect = range.getBoundingClientRect();
      root.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));

      return { ok: true };
    },
    { exact, occurrence },
  );

  if (!result.ok) {
    throw new Error(result.reason);
  }

  await expect(inlineCommentAffordance(page)).toBeVisible();
}

/**
 * The floating "Comment" affordance that pops over a fresh text selection. Scoped
 * to the fixed-position composer button so it never collides with a thread card's
 * "Comment" reply-mode toggle once a comment already exists in the rail — the case
 * a multi-comment journey (e.g. update-content) hits.
 */
function inlineCommentAffordance(page: Page): Locator {
  return page.locator('button.fixed', { hasText: 'Comment' });
}

export async function openInlineComposerForText(page: Page, exact: string): Promise<void> {
  await selectDocumentText(page, exact);
  await inlineCommentAffordance(page).click();
  await expect(page.getByLabel('Inline comment', { exact: true })).toBeVisible();
}

export async function postInlineComment(page: Page, exact: string, body: string): Promise<void> {
  await openInlineComposerForText(page, exact);
  await page.getByLabel('Inline comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(threadRail(page).getByText(body, { exact: true })).toBeVisible();
}

export async function proposeSuggestion(
  page: Page,
  exact: string,
  proposedText: string,
  note: string,
): Promise<void> {
  await openInlineComposerForText(page, exact);
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await page.getByLabel('Suggested replacement', { exact: true }).fill(proposedText);
  await page.getByLabel('Suggestion note', { exact: true }).fill(note);
  await page.getByRole('button', { name: 'Submit suggestion', exact: true }).click();

  const rail = threadRail(page);
  await expect(rail.getByText(note, { exact: true })).toBeVisible();
  await expect(rail.getByText(proposedText, { exact: true })).toBeVisible();
}

export function threadRail(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Thread rail' });
}
