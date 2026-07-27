import { expect, test } from '@playwright/test';
import { register, uniqueIdentity } from './helpers';

// The #123 journey (M3.9 — app chrome catalogs + the 13A chip glossary),
// layered on the #122 tracer's fixtures: the tracer proved the locale PIPELINE
// on the header shell; this proves the authenticated app BODY renders from the
// catalogs — dashboard, import panel, documents list, activity feed — and that
// the constrained chip glossary reaches real rows.
//
//   • a Spanish browser (Accept-Language es-US, no cookie) gets Spanish
//     dashboard chrome end to end — the ticket's headline AC;
//   • a German browser paste-imports a document through the German UI and the
//     row carries the deliberately short German glossary chips (13A):
//     lifecycle "Entwurf" (ENTWURF via the chip's CSS uppercase) and the
//     source chip's "eingefügt" — plus the Intl-localized sync state.
//
// Register()'s auth steps stay English selectors: the (auth) surface localizes
// with #124, not this ticket.

test.describe('i18n app chrome (#123)', () => {
  test.describe('a Spanish browser', () => {
    // Playwright maps context locale to the Accept-Language header.
    test.use({ locale: 'es-US' });

    test('the dashboard renders translated chrome end to end', async ({ page }) => {
      await register(page, uniqueIdentity('i18n-chrome-es'));

      await expect(page).toHaveURL('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');

      // Queue header (dashboard catalog) — the h1 itself.
      await expect(
        page.getByRole('heading', { level: 1, name: 'Cola de revisión' }),
      ).toBeVisible();

      // Import panel + its tabs (dashboard + imports catalogs).
      await expect(
        page.getByRole('heading', { name: 'Importa un documento' }),
      ).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Pegar una URL' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Pegar contenido' })).toBeVisible();

      // Projects panel (projects catalog). Both the rail and the panel legitimately
      // head themselves "Proyectos" — assert both render, disambiguated by count.
      await expect(
        page.getByRole('heading', { name: 'Proyectos', exact: true }),
      ).toHaveCount(2);
      await expect(
        page.getByRole('button', { name: 'Crear proyecto', exact: true }),
      ).toBeVisible();

      // Documents list heading + the designed empty state (documents catalog).
      await expect(
        page.getByRole('heading', { name: 'Tus documentos' }),
      ).toBeVisible();
      await expect(
        page.getByText('Aún no hay documentos', { exact: true }),
      ).toBeVisible();

      // Recent activity (activity catalog) — the empty-workspace state.
      await expect(
        page.getByRole('heading', { name: 'Actividad reciente' }),
      ).toBeVisible();
      await expect(
        page.getByText('Aún no hay actividad', { exact: true }),
      ).toBeVisible();
    });
  });

  test.describe('a German browser', () => {
    test.use({ locale: 'de-DE' });

    test('a pasted import lands with the short German glossary chips (13A)', async ({
      page,
    }) => {
      await register(page, uniqueIdentity('i18n-chrome-de'));

      await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Prüf-Warteschlange' }),
      ).toBeVisible();

      // Paste-import through the German UI (imports catalog end to end).
      await page.getByRole('tab', { name: 'Inhalt einfügen' }).click();
      await page.getByLabel('Titel').fill('Glossar-Probe');
      await page
        .getByLabel('Inhalt', { exact: true })
        .fill('# Glossar-Probe\n\nDeutscher Chip-Test.');
      await page.getByRole('button', { name: 'Importieren', exact: true }).click();

      // Submit stays home (5A): the row prepends into the German list.
      const row = page
        .getByRole('listitem')
        .filter({ hasText: 'Glossar-Probe' })
        .first();
      await expect(row).toBeVisible();

      // 13A glossary on a real row: the lifecycle chip is the deliberately
      // short German label (rendered ENTWURF by the chip's CSS uppercase), and
      // the provenance chip reads the localized "pasted".
      await expect(row.getByText('Entwurf', { exact: true })).toBeVisible();
      await expect(row.getByText('eingefügt', { exact: true })).toBeVisible();

      // The row settles live and its sync state is the localized one — either
      // still in-flight ("Import läuft…") or the Intl-relative "synchronisiert
      // vor 1 Min." — never the English strings.
      await expect(row.getByText(/Import läuft|synchronisiert/)).toBeVisible();
      await expect(row.getByText(/Importing|synced/)).toHaveCount(0);
    });
  });
});
