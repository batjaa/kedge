import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  createShareLink,
  documentTitle,
  importDocumentFromUrl,
  proposeSuggestion,
  register,
  threadRail,
  uniqueIdentity,
  verifyReviewerByMagicLink,
} from './helpers';

const JOURNEY_TIMEOUT = 120_000;
const ANCHOR_TEXT = 'preserves the document';
const PROPOSED_TEXT = 'keeps the document';

test('reviewer proposes a suggested edit → author accepts → both browsers show accepted', async ({
  page,
  browser,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('suggestion-author');
  const reviewer = uniqueIdentity('suggestion-reviewer');
  const note = `Please tighten this wording ${reviewer.email}`;

  await register(page, author);
  await importDocumentFromUrl(page, PLAIN_DOC.url);
  await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();

  const shareUrl = await createShareLink(page);

  const reviewerContext = await browser.newContext();
  try {
    const reviewerPage = await reviewerContext.newPage();
    await verifyReviewerByMagicLink(
      reviewerPage,
      shareUrl,
      reviewer.email,
      PLAIN_DOC.title,
    );

    await proposeSuggestion(reviewerPage, ANCHOR_TEXT, PROPOSED_TEXT, note);
    await assertSuggestionDiff(threadRail(reviewerPage));

    await page.reload();
    await expect(documentTitle(page, PLAIN_DOC.title)).toBeVisible();
    const authorRail = threadRail(page);
    const authorCard = authorRail.getByRole('article').filter({ hasText: note });
    await expect(authorCard).toBeVisible();
    await assertSuggestionDiff(authorCard);

    await authorCard.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
    await expect(authorCard.getByText('accepted', { exact: true })).toBeVisible();

    await reviewerPage.reload();
    await expect(documentTitle(reviewerPage, PLAIN_DOC.title)).toBeVisible();
    const reviewerCard = threadRail(reviewerPage).getByRole('article').filter({ hasText: note });
    await expect(reviewerCard.getByText('accepted', { exact: true })).toBeVisible();
    await assertSuggestionDiff(reviewerCard);
  } finally {
    await reviewerContext.close();
  }
});

async function assertSuggestionDiff(scope: ReturnType<typeof threadRail>) {
  await expect(exactParagraph(scope, ANCHOR_TEXT)).toBeVisible();
  await expect(exactParagraph(scope, PROPOSED_TEXT)).toBeVisible();
}

function exactParagraph(scope: ReturnType<typeof threadRail>, text: string) {
  return scope.locator('p').filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
