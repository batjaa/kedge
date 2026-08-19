import { expect, test } from '@playwright/test';
import {
  fakeReplyDraft,
  FAKE_SUMMARY_CURRENT_STATE,
  FAKE_SUMMARY_OPEN_QUESTION,
} from './ai-fake';
import { AI_DOC } from './fixtures';
import {
  documentTitle,
  importDocumentFromUrl,
  postInlineComment,
  register,
  threadRail,
  uniqueIdentity,
} from './helpers';

// The thread-panel triage pair (#133, #137): a reply DRAFT and a thread SUMMARY.
//
// The invariant both share is that the AI never acts. The draft lands in the
// composer as ordinary editable text and the author's own submit is what posts
// it — so the journey edits the draft before posting and then checks the
// comment carries the human's name and no agent badge. The summary changes
// nothing at all.
//
// The stance is asserted through the CONTENT of the draft: the scripted fake
// echoes the stance it was prompted with (see api's FakeAiServiceProvider), so
// clicking "Push back" and receiving an accepting draft fails here rather than
// passing because a textarea happens to be non-empty.

const JOURNEY_TIMEOUT = 180_000;

/** Comments a thread needs before the summary affordance appears (AI_SUMMARY_MIN_COMMENTS). */
const LONG_THREAD_COMMENTS = 8;

test('a stance-picked draft lands in the composer, is edited, posts as the human, and a long thread summarizes', async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  const author = uniqueIdentity('ai-triage');
  const opening = `Opening the triage thread ${author.email}`;
  const draft = fakeReplyDraft('push back');
  const edited = `${draft} And this sentence is mine, typed over the draft.`;

  await register(page, author);
  await importDocumentFromUrl(page, AI_DOC.url);
  await expect(documentTitle(page, AI_DOC.title)).toBeVisible();

  await postInlineComment(page, AI_DOC.triageAnchor, opening);

  const rail = threadRail(page);
  const card = rail.getByRole('article').filter({ hasText: opening });
  await expect(card).toBeVisible();

  // Grow the thread to one comment short of "long", so the reply drafted below
  // is what tips it over — and so the gate itself is under test, not assumed.
  for (let index = 1; index <= LONG_THREAD_COMMENTS - 2; index += 1) {
    const reply = `Reply ${index} on the anchored passage ${author.email}`;
    await card.getByLabel('Reply', { exact: true }).fill(reply);
    await card.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(card.getByText(reply, { exact: true })).toBeVisible();
  }

  await expect(card.getByRole('button', { name: 'Summarize', exact: true })).toHaveCount(0);

  // ---- The stance picker drafts a reply INTO the composer -----------------
  const composer = card.getByLabel('Reply', { exact: true });
  await expect(composer).toHaveValue('');

  await card.getByRole('button', { name: 'Push back', exact: true }).click();
  await expect(composer).toHaveValue(draft);
  // Said out loud, because it is the whole contract of this control.
  await expect(card.getByText('Nothing is posted until you press Reply.', { exact: false })).toBeVisible();

  // ---- The author edits it, and the author posts it -----------------------
  await composer.fill(edited);
  await card.getByRole('button', { name: 'Post reply', exact: true }).click();

  await expect(card.getByText(edited, { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  // Posted as the person: their name on the row, and no agent badge anywhere in
  // this thread. An AI-drafted reply is still the human's comment.
  await expect(card.getByText(author.name, { exact: true }).first()).toBeVisible();
  await expect(card.getByText('mcp', { exact: true })).toHaveCount(0);
  await expect(card.getByText('agent', { exact: true })).toHaveCount(0);

  // ---- Eight comments in, the thread offers a summary ---------------------
  const summarize = card.getByRole('button', { name: 'Summarize', exact: true });
  await expect(summarize).toBeVisible();
  await summarize.click();

  await expect(card.getByText('Where it stands', { exact: true })).toBeVisible();
  await expect(card.getByText(FAKE_SUMMARY_CURRENT_STATE, { exact: true })).toBeVisible();
  await expect(card.getByText('Open question', { exact: true })).toBeVisible();
  await expect(card.getByText(FAKE_SUMMARY_OPEN_QUESTION, { exact: true })).toBeVisible();
  // Counted from the real thread, not from the fake — the summary read what is
  // actually there.
  await expect(
    card.getByText(`Covers all ${LONG_THREAD_COMMENTS} comments.`, { exact: true }),
  ).toBeVisible();
  // A summary is a read: the thread it summarizes is untouched.
  await expect(card.getByText('Nothing in this thread changed.', { exact: false })).toBeVisible();
  await expect(card.getByText('open', { exact: true })).toBeVisible();
});
