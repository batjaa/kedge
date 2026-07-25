import { expect, test } from '@playwright/test';

// The landing i18n journey (SPEC m3.9 story 6; #125). The tracer journey
// (i18n.spec.ts, #122) already proves the cookie pipeline on the landing — an
// anonymous visitor's hand-set NEXT_LOCALE is honored and survives reload. This
// spec extends that pattern to what #125 adds, without re-proving it:
//
//   • an es-US browser (Accept-Language negotiation, no cookie) gets the SPANISH
//     landing on first paint — the funnel copy itself, not just html lang;
//   • the FOOTER switcher — the anonymous visitor's only switcher, there is no
//     app header here — overrides to Mongolian and persists across reload via
//     the same cookie server action the app header uses.
//
// Runs against the SaaS instance (default origin), where the anonymous root is
// the marketing landing (landing.spec.ts owns the edition branch itself).

test.describe('landing i18n', () => {
  test.describe('an es-US browser, anonymous', () => {
    // Playwright maps context locale to the Accept-Language header.
    test.use({ locale: 'es-US' });

    test('gets the Spanish landing on first paint', async ({ page }) => {
      await page.goto('/');

      // No cookie was ever set: negotiation alone drives the first paint.
      await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');

      // The funnel reads Spanish end to end: hero, demo affordance, roadmap
      // band, email funnel, footer tagline.
      await expect(
        page.getByRole('heading', { name: /Pega un enlace\./, level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Renderízalo', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /Disponible hoy/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Crear mi espacio de trabajo', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Comentarios que no pierden su lugar.', { exact: true }),
      ).toBeVisible();
    });
  });

  test('the footer switcher overrides to Mongolian for an anonymous visitor and persists', async ({
    page,
  }) => {
    await page.goto('/');

    // Default context: English landing, no cookie.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(
      page.getByRole('heading', { name: /Paste a link\./, level: 1 }),
    ).toBeVisible();

    // The anonymous switcher lives in the landing footer (the only switcher on
    // this surface — labelled "Language" in the current locale). Selecting the
    // "Монгол" endonym runs the cookie server action and refreshes.
    const footer = page.getByRole('contentinfo');
    await footer.getByLabel('Language', { exact: true }).selectOption('mn-MN');

    await expect(page.locator('html')).toHaveAttribute('lang', 'mn-MN');
    await expect(
      page.getByRole('heading', { name: /Холбоос буулга\./, level: 1 }),
    ).toBeVisible();
    // The switcher relabels in the new locale, like the app header's does.
    await expect(footer.getByLabel('Хэл', { exact: true })).toBeVisible();

    // Persistence: a full reload keeps the choice — locale is a cookie, not a
    // session detail, so a stranger's pick survives without an account.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'mn-MN');
    await expect(
      page.getByRole('heading', { name: /Холбоос буулга\./, level: 1 }),
    ).toBeVisible();
  });
});
