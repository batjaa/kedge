import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import { createShareLink, documentTitle, importDocumentFromUrl, register, uniqueIdentity } from './helpers';

// The shared-surface i18n journey (SPEC m3.9, story 3 / eng-review 4A; #124).
// An invited reviewer on a share link has NO account, so the shared-doc surface
// must offer the same cookie-backed language switcher as the app header:
//
//   • a guest opens a share link in a fresh, cookie-less context and gets
//     English chrome (no cookie, default Accept-Language);
//   • the switcher — available without any auth — flips the chrome to Spanish
//     via the server-action cookie;
//   • the choice SURVIVES a full reload (cookie, not session state);
//   • the document CONTENT stays exactly as authored throughout — document
//     text is never translated (SPEC m3.9, hard rule).
//
// Plus the auth surface (#124's other lane half): the locale cookie the
// switcher writes drives the sign-in/sign-up chrome the same way.

test('a guest on a share link switches the chrome to Spanish and the choice survives reload', async ({
  page,
  browser,
}) => {
  // Owner side: import a doc and mint a share link.
  await register(page, uniqueIdentity('i18n-shared'));
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  const shareUrl = await createShareLink(page);

  // Guest side: fresh context — no cookies, no session, default (English) locale.
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(shareUrl);

    // English chrome by default; the switcher is present without any auth.
    await expect(guest.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(guest.getByText('Shared document · read-only')).toBeVisible();
    await expect(
      guest.getByRole('link', { name: 'Review your own spec with Kedge', exact: false }),
    ).toBeVisible();

    // Switch to Spanish. The select is labelled in the current locale
    // ("Language" in English); options are endonyms, values are locale tags.
    await guest.getByLabel('Language', { exact: true }).selectOption('es-US');

    // The server action set the cookie and the refresh re-rendered the chrome:
    // html lang flips, eyebrow + footer speak Spanish, and the switcher itself
    // is relabelled ("Idioma").
    await expect(guest.locator('html')).toHaveAttribute('lang', 'es-US');
    await expect(guest.getByText('Documento compartido · solo lectura')).toBeVisible();
    await expect(
      guest.getByRole('link', { name: 'Revisa tu propia especificación con Kedge', exact: false }),
    ).toBeVisible();
    await expect(guest.getByLabel('Idioma', { exact: true })).toBeVisible();

    // The document body is user content and must never be translated.
    await expect(guest.getByText(PLAIN_DOC.body)).toBeVisible();

    // Persistence: a full reload keeps Spanish — the cookie, not transient state.
    await guest.reload();
    await expect(guest.locator('html')).toHaveAttribute('lang', 'es-US');
    await expect(guest.getByText('Documento compartido · solo lectura')).toBeVisible();
    await expect(guest.getByText(PLAIN_DOC.body)).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test('the locale cookie localizes the sign-in and sign-up chrome', async ({ page }) => {
  // The same cookie the switcher writes (validated against the strict allowlist
  // on read, 4A) drives the auth surface for a signed-out visitor.
  await page.context().addCookies([
    {
      name: 'NEXT_LOCALE',
      value: 'de-DE',
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Konto erstellen', exact: true })).toBeVisible();

  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { name: 'Konto erstellen', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Konto erstellen', exact: true }),
  ).toBeVisible();
});
