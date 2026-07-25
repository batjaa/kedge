import { expect, test } from '@playwright/test';
import { register, uniqueIdentity } from './helpers';

// The i18n journey (SPEC m3.9 — Testing Decisions; #122, the M3.9 tracer). Proves
// the whole locale pipeline on the app header/shell tracer surface:
//
//   • a Spanish browser (Accept-Language: es-US) gets Spanish header chrome
//     automatically — no cookie, pure negotiation (eng-review 4A);
//   • the header switcher overrides to Mongolian and the choice PERSISTS across a
//     full reload (cookie + server action), for a signed-in user;
//   • switching to mn-MN flips display headings to the system stack wholesale —
//     Space Grotesk out, no per-glyph fallback (eng-review 12A);
//   • the same locale cookie the switcher writes is honored for an ANONYMOUS
//     visitor and survives reload too.
//
// Only the app header/shell strings are translated in this tracer; auth and the
// review-queue body stay English until the surface tickets (#123–#126), so the
// register() helper's English selectors are unaffected.

const SPACE_GROTESK = /Space Grotesk/i;

async function headingFontFamily(page: import('@playwright/test').Page): Promise<string> {
  return page
    .getByRole('heading', { name: 'Review queue' })
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
}

test.describe('i18n', () => {
  test.describe('a Spanish browser, signed in', () => {
    // Playwright maps context locale to the Accept-Language header.
    test.use({ locale: 'es-US' });

    test('negotiates Spanish chrome, switches to Mongolian, and persists across reload', async ({
      page,
    }) => {
      await register(page, uniqueIdentity('i18n'));

      // Landed on the review queue in the authenticated shell. No locale cookie
      // yet, so Accept-Language (es-US) alone drives the chrome.
      await expect(page).toHaveURL('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');

      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav.getByText('Documentos', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cerrar sesión', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Importar', exact: true }),
      ).toBeVisible();

      // Latin locale → Space Grotesk display face on headings.
      expect(await headingFontFamily(page)).toMatch(SPACE_GROTESK);

      // Override to Mongolian via the header switcher (labelled in the current
      // locale, "Idioma" in Spanish). The endonym option is "Монгол" / value mn-MN.
      await page.getByLabel('Idioma', { exact: true }).selectOption('mn-MN');

      // The server action set the cookie and refreshed: chrome is now Mongolian,
      // html lang flipped, and the switcher relabelled to "Хэл".
      await expect(page.locator('html')).toHaveAttribute('lang', 'mn-MN');
      await expect(nav.getByText('Баримтууд', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Хэл', { exact: true })).toBeVisible();

      // 12A: mn-MN has no Cyrillic in Space Grotesk, so headings resolve to the
      // system sans stack wholesale — Space Grotesk must be gone.
      expect(await headingFontFamily(page)).not.toMatch(SPACE_GROTESK);

      // Persistence: a full reload keeps Mongolian for the signed-in user.
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'mn-MN');
      await expect(nav.getByText('Баримтууд', { exact: true })).toBeVisible();
      expect(await headingFontFamily(page)).not.toMatch(SPACE_GROTESK);
    });
  });

  test('an anonymous visitor keeps the locale cookie the switcher writes across reload', async ({
    page,
  }) => {
    // The switcher's server action sets exactly this cookie; an anonymous visitor
    // (no session) must have it honored the same way a signed-in one does — locale
    // is a cookie, not a session detail. /docs is public and API-free.
    await page.context().addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'de-DE',
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/docs');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  });
});
