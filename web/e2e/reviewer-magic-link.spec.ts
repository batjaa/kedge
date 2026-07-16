import { expect, test } from '@playwright/test';
import { PLAIN_DOC } from './fixtures';
import {
  createShareLink,
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  uniqueIdentity,
  verifyReviewerByMagicLink,
} from './helpers';

const JOURNEY_TIMEOUT = 120_000;
const ANCHOR_TEXT = 'preserves the document';

test('author shares → anonymous reviewer verifies by log-mail magic link → posts anchored comment', async ({
  page,
  browser,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('reviewer-magic-author');
  const reviewer = uniqueIdentity('reviewer-magic-reviewer');
  const comment = `Reviewer magic-link comment ${reviewer.email}`;

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
    await postInlineComment(reviewerPage, ANCHOR_TEXT, comment);

    await expect(
      reviewerPage
        .getByRole('button', { name: 'Open thread', exact: true })
        .filter({ hasText: ANCHOR_TEXT }),
    ).toBeVisible();
  } finally {
    await reviewerContext.close();
  }
});
