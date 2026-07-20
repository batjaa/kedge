import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// Share-link lifecycle (import-render spec — SPEC §10.2; #39). The whole arc of an
// unguessable, revocable read-only link: create it with an expiry, copy the URL
// shown only once, open it read-only in a fresh cookie-less context (noindex,
// no owner chrome), then revoke it — after which the very same URL lands on the
// friendly "gone" page, never a raw error, never leaking whether it existed.

test('create share with expiry → open read-only in a fresh context → revoke → gone page', async ({
  page,
  browser,
}) => {
  await register(page, uniqueIdentity('share'));
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  // Create a share link with a bounded expiry.
  await expect(
    page.getByRole('heading', { name: 'Share links' }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Share expiry' })
    .selectOption({ label: 'Expires in 7 days' });
  await page.getByRole('button', { name: 'Create share link', exact: true }).click();

  // The one-time URL banner: the token is shown exactly once, here.
  await expect(page.getByText('it is shown only once', { exact: false })).toBeVisible();
  const shareUrl = await page.locator('input[readonly]').inputValue();
  expect(shareUrl).toMatch(/\/shared\/[A-Za-z0-9_-]{32,}$/);

  // Open the link in a fresh, cookie-less context: read-only, no owner chrome,
  // and noindex so a "private link" never enters a search index.
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(shareUrl);

    await expect(guest.getByText('Shared document · read-only')).toBeVisible();
    // The synthesized title legitimately appears twice (share header + body H1).
    await expect(
      guest.getByRole('heading', { name: PLAIN_DOC.title }).first(),
    ).toBeVisible();
    await expect(guest.getByText(PLAIN_DOC.body)).toBeVisible();

    // Read-only: none of the authenticated/owner surface leaks through the token.
    await expect(
      guest.getByRole('button', { name: 'Sign out', exact: true }),
    ).toBeHidden();
    await expect(guest.getByRole('heading', { name: 'Share links' })).toBeHidden();

    // noindex: the <meta name="robots"> the /shared layout sets (matched by the
    // X-Robots-Tag header from next.config).
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/i,
    );
  } finally {
    await guestContext.close();
  }

  // Revoke the link from the owner's document page.
  const revoke = page.getByRole('button', { name: 'Revoke', exact: true });
  await expect(revoke).toBeVisible();
  await revoke.click();
  await expect(revoke).toBeHidden();

  // The very same URL now goes dark — the friendly gone page, on the next open.
  const afterRevoke = await browser.newContext();
  try {
    const stranger = await afterRevoke.newPage();
    await stranger.goto(shareUrl);

    await expect(
      stranger.getByRole('heading', { name: 'This link is no longer active' }),
    ).toBeVisible();
    await expect(stranger.getByText('The author has revoked this share link', { exact: false })).toBeVisible();
    // The document content is gone with the link.
    await expect(stranger.getByText(PLAIN_DOC.body)).toBeHidden();
  } finally {
    await afterRevoke.close();
  }
});
