import { expect, test } from '@playwright/test';
import { formIsHydrated, signIn, uniqueIdentity } from './helpers';
import { latestAccountMailUrl } from './mailbox';

test('an existing unverified password account confirms on another device and preserves its destination', async ({ page, browser }, testInfo) => {
  const identity = uniqueIdentity('account-recovery');
  const destination = '/settings?section=profile';
  await page.goto(`/signup?next=${encodeURIComponent(destination)}`);
  await formIsHydrated(page);
  await page.getByLabel('Name', { exact: true }).fill(identity.name);
  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(`/verify-email?next=${encodeURIComponent(destination)}`);
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  const forbidden = await page.request.get('http://localhost:8000/api/v1/documents', { headers: { accept: 'application/json', origin: new URL(page.url()).origin } });
  expect(forbidden.status()).toBe(403);

  // This account now represents a pre-confirmation rollout user: it has a
  // persisted password/session record, but no verification timestamp. Re-enter
  // through sign-in instead of relying on signup's immediate redirect.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin/);
  await page.goto(`/signin?next=${encodeURIComponent(destination)}`);
  await signIn(page, identity, `/verify-email?next=${encodeURIComponent(destination)}`);
  const beforeConfirmation = await page.request.get('http://localhost:8000/api/v1/me', { headers: { accept: 'application/json', origin: new URL(page.url()).origin } });
  expect(await beforeConfirmation.json()).toMatchObject({ email_verified: false });

  const shots = testInfo.outputPath();
  await page.screenshot({ path: `${shots}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Resend confirmation email' }).click();
  await expect(page.getByRole('status')).toContainText('Confirmation email requested');
  const confirmation = await latestAccountMailUrl(identity.email, 'verify');
  const otherDevice = await browser.newContext();
  const otherPage = await otherDevice.newPage();
  await otherPage.goto(`${confirmation}tampered`);
  await expect(otherPage.getByRole('main').getByRole('alert')).toContainText('invalid or expired');
  await otherPage.goto(confirmation);
  await expect(otherPage.getByRole('heading', { name: 'Email confirmed', exact: true })).toBeVisible();
  await expect(otherPage.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await otherDevice.close();

  // The original session must observe the fresh verification state after a
  // refresh; confirmation itself deliberately never logs the other device in.
  const afterConfirmation = await page.request.get('http://localhost:8000/api/v1/me', { headers: { accept: 'application/json', origin: new URL(page.url()).origin } });
  expect(await afterConfirmation.json()).toMatchObject({ email_verified: true });
  await page.getByRole('button', { name: 'I’ve confirmed my email' }).click();
  await expect(page).toHaveURL(destination);
  await page.waitForLoadState('networkidle');

  // Re-open the protected destination in the original browser context. Its
  // persisted session must retain the newly observed verification state.
  await page.reload();
  await expect(page).toHaveURL(destination);

  const freshDevice = await browser.newContext();
  const freshPage = await freshDevice.newPage();
  await freshPage.goto(`/signin?next=${encodeURIComponent(destination)}`);
  await signIn(freshPage, identity, destination);
  await freshDevice.close();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin/);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await formIsHydrated(page);
  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('reset link is on its way');
  await page.goto(await latestAccountMailUrl(identity.email, 'reset'));
  await formIsHydrated(page);
  await page.screenshot({ path: `${shots}/reset-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/reset-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(identity.email);
  const password = 'new-correct-horse-password';
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill('mismatch');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('#password-error')).toBeVisible();
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your password has been reset');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await signIn(page, { email: identity.email, password });
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
});
