import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  register,
  signIn,
  uniqueIdentity,
} from './helpers';

// Auth edges (scaffold spec — the auth surface beyond M0's happy path; #39). The
// three ways the cross-app auth handshake is exercised at its boundaries: a
// friendly error for a wrong password, a friendly error for a duplicate email,
// and the anonymous deep-link → signin?next= → land-back-where-you-were loop the
// (app) guard implements. Each test registers its own unique user (helpers.ts),
// so they are independent and worker-safe.

test('wrong password shows a friendly field error, no session', async ({ page }) => {
  const identity = uniqueIdentity('auth-wrongpw');
  await register(page, identity);

  // Sign out to reach the signed-out sign-in form.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin(\?|$)/);

  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill('the-wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // A friendly, field-anchored error — never a raw 422 or a stack trace — and no
  // navigation off the sign-in page (the credentials were rejected).
  await expect(
    page.getByText('These credentials do not match our records.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeHidden();
});

test('duplicate-email registration shows a friendly field error', async ({ page }) => {
  const identity = uniqueIdentity('auth-dupe');
  // Register once to occupy the email, then sign out and try to register it again.
  await register(page, identity);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin(\?|$)/);

  await page.goto('/signup');
  await page.getByLabel('Name', { exact: true }).fill('Second Signup');
  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  await expect(
    page.getByText('An account with this email already exists.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/signup(\?|$)/);
});

test('anonymous deep-link to a document → signin?next= → lands back on the document', async ({
  page,
}) => {
  const identity = uniqueIdentity('auth-deeplink');
  await register(page, identity);

  // A real owned document to deep-link to.
  const id = await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  // Go anonymous.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin(\?|$)/);

  // The guard bounces an anonymous deep-link to sign-in, carrying the original
  // path as the return target.
  const deepLink = `/documents/${id}`;
  await page.goto(deepLink);
  await expect(page).toHaveURL(
    new RegExp(`/signin\\?next=${encodeURIComponent(deepLink)}$`),
  );

  // Signing in completes the return: we land back on the document we asked for.
  await signIn(page, identity, new RegExp(`/documents/${id}$`));
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
});
