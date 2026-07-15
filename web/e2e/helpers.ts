import { expect, type Page } from '@playwright/test';

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
 * land on its page. The E2E queue is synchronous (serve-api.sh), so by the time
 * the API answers the import has already run — the document page renders its
 * ready (or failed) state on first load, no poll to wait on. Returns the numeric
 * document id parsed from the URL.
 */
export async function importDocumentFromUrl(page: Page, url: string): Promise<number> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Import a document' }),
  ).toBeVisible();

  await page.getByLabel('Document URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

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
