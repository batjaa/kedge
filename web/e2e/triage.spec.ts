import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';

const JOURNEY_TIMEOUT = 120_000;
const ANCHOR_TEXT = 'ordinary prose';

test('author replies, forks the reply, resolves the original, and navigates rail + TOC', async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('triage-author');
  const openingComment = `Opening triage thread ${author.email}`;
  const forkedReply = `Fork this reply into its own thread ${author.email}`;

  await register(page, author);
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  await postInlineComment(page, ANCHOR_TEXT, openingComment);

  const rail = threadRail(page);
  const originalCard = rail.getByRole('article').filter({ hasText: openingComment });
  await expect(originalCard).toBeVisible();

  await originalCard.getByLabel('Reply', { exact: true }).fill(forkedReply);
  await originalCard.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(originalCard.getByText(forkedReply, { exact: true })).toBeVisible();

  await originalCard.getByRole('button', { name: 'Fork into new thread', exact: true }).click();
  const forkedCard = rail
    .getByRole('article')
    .filter({ hasText: /Forked from comment #\d+/ })
    .filter({ hasText: forkedReply });
  await expect(forkedCard).toBeVisible();

  await originalCard.getByRole('button', { name: 'Resolve thread', exact: true }).click();
  await expect(originalCard.getByText('resolved', { exact: true })).toBeVisible();
  await expect(originalCard.getByText('Forked into 1 thread', { exact: true })).toBeVisible();

  const cardTexts = await rail.getByRole('article').allTextContents();
  const originalIndex = cardTexts.findIndex((text) => text.includes(openingComment));
  const forkedIndex = cardTexts.findIndex(
    (text) => text.includes('Forked from comment #') && text.includes(forkedReply),
  );
  expect(originalIndex).toBeGreaterThanOrEqual(0);
  expect(forkedIndex).toBeGreaterThanOrEqual(0);
  expect(originalIndex).toBeLessThan(forkedIndex);

  await page
    .getByRole('navigation', { name: 'Document table of contents' })
    .getByRole('button', { name: 'What the journey asserts', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'What the journey asserts', exact: true }),
  ).toBeInViewport();

  await page
    .getByRole('navigation', { name: 'Threads' })
    .getByRole('button', { name: /ordinary prose/ })
    .first()
    .click();

  const highlight = page
    .getByRole('button', { name: /Open thread|Open threads/ })
    .filter({ hasText: ANCHOR_TEXT })
    .first();
  await expect(highlight).toBeVisible();
});
