import { expect, test } from '@playwright/test';
import { FAKE_SPLIT_QUOTES, FAKE_SPLIT_TITLES } from './ai-fake';
import { AI_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';

// AI-proposed comment splits (#134, #137): one sprawling comment becomes several
// tracked conversations — but only where a human approves each one.
//
// The proposal itself writes nothing. Approving is what writes, and it writes
// through the ordinary fork endpoint with the proposal's anchor, validated
// against the live projection exactly as a browser-captured selection is. So
// the journey ends at the rail: two forked threads, each quoting its OWN
// passage rather than inheriting the source thread's selection — which is the
// only visible difference between "the anchors travelled" and "the anchors were
// silently dropped".

const JOURNEY_TIMEOUT = 180_000;

test('an AI split proposal is reviewed, two splits are approved, and each forked thread keeps its own anchor', async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('ai-split');
  const opening = `Opening the split thread ${author.email}`;
  // Deliberately two issues in one comment — and deliberately quoting neither
  // proposal's document text, so a rail assertion below can tell the forks apart
  // by their anchors alone.
  const sprawling = [
    `Two separate things bother me here ${author.email}.`,
    'First, re-importing has to leave this selection alone.',
    'Second, generated output must never post itself.',
  ].join(' ');

  await register(page, author);
  await importDocumentFromUrl(page, AI_DOC.url);
  await expect(documentTitle(page, AI_DOC.title)).toBeVisible();

  await postInlineComment(page, AI_DOC.splitAnchor, opening);

  const rail = threadRail(page);
  const source = rail.getByRole('article').filter({ hasText: opening });
  await expect(source).toBeVisible();

  // The sprawling comment is a REPLY: forking (and so splitting) is offered on
  // replies, never on the comment that opened the thread.
  await source.getByLabel('Reply', { exact: true }).fill(sprawling);
  await source.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(source.getByText(sprawling, { exact: true })).toBeVisible();

  // ---- Propose ------------------------------------------------------------
  await source.getByRole('button', { name: 'Propose a split', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Split this comment' });
  await expect(dialog.getByText('No split proposed for this comment yet.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Propose a split', exact: true }).click();

  // The proposals are a review list, and nothing exists yet.
  await expect(dialog.getByText('Covers all 1 comment.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('0 of 2 approved', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Nothing has been created yet.', { exact: false })).toBeVisible();
  await expect(rail.getByRole('article')).toHaveCount(1);

  for (const [index, title] of FAKE_SPLIT_TITLES.entries()) {
    const proposal = dialog.getByRole('listitem').filter({ hasText: title });
    await expect(proposal).toBeVisible();
    // Each proposal points at its own passage — not at the whole selection the
    // source thread is anchored to.
    await expect(proposal.getByText(FAKE_SPLIT_QUOTES[index], { exact: true })).toBeVisible();
  }

  // Each proposal is approvable on its own — the list is a review, not an
  // all-or-nothing offer.
  await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(2);

  // ---- Approve both -------------------------------------------------------
  // Approving forks, and the surface follows the author to the thread it just
  // created — which collapses the source card the panel was rendered inside, so
  // the outcome is asserted where it lives from here on: the rail.
  await dialog.getByRole('button', { name: 'Approve all (2)', exact: true }).click();

  // ---- Two forked threads, two anchors ------------------------------------
  const forks = rail.getByRole('article').filter({ hasText: /Forked from comment #\d+/ });
  await expect(forks).toHaveCount(2);
  await expect(forks.filter({ hasText: FAKE_SPLIT_QUOTES[0] })).toHaveCount(1);
  await expect(forks.filter({ hasText: FAKE_SPLIT_QUOTES[1] })).toHaveCount(1);
  // Neither inherited the source thread's selection: the proposal's anchor is
  // what each fork was created with.
  await expect(forks.filter({ hasText: AI_DOC.splitAnchor })).toHaveCount(0);
  // Each fork carries the comment it was split out of, whole (the M2 fork
  // mechanism, unchanged — the split decides the anchor, not the body).
  await expect(forks.filter({ hasText: sprawling })).toHaveCount(2);

  await expect(source.getByText('Forked into 2 threads', { exact: true })).toBeVisible();
});
