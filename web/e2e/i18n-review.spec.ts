import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  createShareLink,
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
  verifyReviewerByMagicLink,
} from './helpers';

// The review-surface i18n journey (SPEC m3.9; #126, the module's last surface).
// The earlier journeys proved the pipeline (#122), the app body (#123), and the
// shared/auth chrome (#124); this one proves the REVIEW chrome — header, sidebar,
// thread rail, cards, composers, share links, version nav — renders from the
// catalogs while everything the user wrote stays byte-identical:
//
//   • an owner with an open thread switches to Spanish and every layer of
//     review chrome flips, while the document body and the comment body remain
//     exactly as authored (the hard rule: content is never translated);
//   • the choice survives a reload (cookie, not transient state);
//   • the guest switcher on a share link — #124's lane, deliberately left
//     asserting only shared-surface chrome — now flips the embedded review
//     chrome too (mn-MN here, so a second locale crosses the review surface).
//     The rail only embeds for a VERIFIED reviewer (the shared page renders
//     read-only prose for anonymous guests), so the guest verifies first.
//
// Setup steps (register/import/comment) run in the default English context so
// the shared helpers' en-US selectors stay valid; the switch happens last.

const ANCHOR_TEXT = 'preserves the document';

test('an owner switches the review page to Spanish around verbatim content', async ({
  page,
}) => {
  const owner = uniqueIdentity('i18n-review');
  const comment = `Review-chrome i18n journey ${owner.email}`;

  await register(page, owner);
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  await postInlineComment(page, ANCHOR_TEXT, comment);

  // Flip to Spanish via the header switcher (labelled "Language" in English).
  await page.getByLabel('Language', { exact: true }).selectOption('es-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');

  // Review header: the open-thread counter localizes with a proper Spanish
  // singular (ICU plural — "1 abierto", never "1 abiertos").
  await expect(page.getByText('1 abierto', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprobar', exact: true })).toBeVisible();

  // Sidebar: contents + threads headings and the nav status label.
  await expect(page.getByRole('heading', { name: 'Documento', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hilos', exact: true })).toBeVisible();

  // Version nav (review catalog) — aria-label, so the accessible name localizes.
  await expect(
    page.getByRole('navigation', { name: 'Versiones del documento' }),
  ).toBeVisible();

  // Thread rail (threads catalog): the rail's accessible name, the card title,
  // and the open status badge all speak Spanish; the English rail name is gone.
  const rail = page.getByRole('complementary', { name: 'Panel de hilos' });
  await expect(rail).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Thread rail' })).toHaveCount(0);
  await expect(rail.getByText('Hilo', { exact: true })).toBeVisible();
  await expect(rail.getByText('abierto', { exact: true })).toBeVisible();

  // Share links (shares catalog).
  await expect(
    page.getByRole('heading', { name: 'Enlaces para compartir', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Crear enlace para compartir', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Share links' })).toHaveCount(0);

  // The hard rule: document prose and the comment body are user content and
  // must remain exactly as written, in Spanish chrome.
  await expect(page.getByText(PLAIN_DOC.body)).toBeVisible();
  await expect(rail.getByText(comment, { exact: true })).toBeVisible();

  // Persistence: a full reload keeps the Spanish review chrome and the verbatim
  // content (the cookie, not session state).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await expect(
    page.getByRole('complementary', { name: 'Panel de hilos' }),
  ).toBeVisible();
  await expect(page.getByText(PLAIN_DOC.body)).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'Panel de hilos' })
      .getByText(comment, { exact: true }),
  ).toBeVisible();
});

test('the guest switcher on a share link flips the embedded review chrome', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  // Owner side (English): import and mint a share link.
  const owner = uniqueIdentity('i18n-review-share');
  const reviewer = uniqueIdentity('i18n-review-reviewer');
  const comment = `Shared review-chrome i18n ${reviewer.email}`;

  await register(page, owner);
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
  const shareUrl = await createShareLink(page);

  // Reviewer side: fresh context, magic-link verification, then an anchored
  // comment — all under the default English chrome, so the shared helpers'
  // en-US selectors stay valid.
  const reviewerContext = await browser.newContext();
  try {
    const reviewerPage = await reviewerContext.newPage();
    await verifyReviewerByMagicLink(reviewerPage, shareUrl, reviewer.email, PLAIN_DOC.title);
    await postInlineComment(reviewerPage, ANCHOR_TEXT, comment);
    await expect(threadRail(reviewerPage)).toBeVisible();

    // The guest switcher (#124) now reaches the review chrome (#126): Mongolian
    // rail name and card title, English rail name gone, content verbatim.
    await reviewerPage.getByLabel('Language', { exact: true }).selectOption('mn-MN');
    await expect(reviewerPage.locator('html')).toHaveAttribute('lang', 'mn-MN');

    const rail = reviewerPage.getByRole('complementary', { name: 'Хэлэлцүүлгийн самбар' });
    await expect(rail).toBeVisible();
    await expect(
      reviewerPage.getByRole('complementary', { name: 'Thread rail' }),
    ).toHaveCount(0);
    await expect(rail.getByText('Хэлэлцүүлэг', { exact: true })).toBeVisible();
    await expect(rail.getByText('нээлттэй', { exact: true })).toBeVisible();

    await expect(reviewerPage.getByText(PLAIN_DOC.body)).toBeVisible();
    await expect(rail.getByText(comment, { exact: true })).toBeVisible();
  } finally {
    await reviewerContext.close();
  }
});
